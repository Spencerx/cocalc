import * as nats from "nats.ws";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { redux } from "@cocalc/frontend/app-framework";
import type { WebappClient } from "@cocalc/frontend/client/client";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";
import { join } from "path";
import * as jetstream from "@nats-io/jetstream";
import {
  createSyncTable,
  type NatsSyncTable,
  NatsSyncTableFunction,
} from "@cocalc/nats/sync/synctable";
import { inboxPrefix, randomId } from "@cocalc/nats/names";
import { browserSubject, projectSubject } from "@cocalc/nats/names";
import { parse_query } from "@cocalc/sync/table/util";
import { sha1 } from "@cocalc/util/misc";
import { keys } from "lodash";
import { type HubApi, initHubApi } from "@cocalc/nats/hub-api";
import { type ProjectApi, initProjectApi } from "@cocalc/nats/project-api";
import { type BrowserApi, initBrowserApi } from "@cocalc/nats/browser-api";
import { getPrimusConnection } from "@cocalc/nats/primus";
import { isValidUUID } from "@cocalc/util/misc";
import { createOpenFiles, OpenFiles } from "@cocalc/nats/sync/open-files";
import { PubSub } from "@cocalc/nats/sync/pubsub";
import type { ChatOptions } from "@cocalc/util/types/llm";
import { kv, type KVOptions, type KV } from "@cocalc/nats/sync/kv";
import { dkv, type DKVOptions, type DKV } from "@cocalc/nats/sync/dkv";
import { dko, type DKOOptions, type DKO } from "@cocalc/nats/sync/dko";
import {
  stream,
  type UserStreamOptions,
  type Stream,
} from "@cocalc/nats/sync/stream";
import { dstream, type DStream } from "@cocalc/nats/sync/dstream";
import { initApi } from "@cocalc/frontend/nats/api";
import { delay } from "awaiting";
import { Svcm } from "@nats-io/services";
import { CONNECT_OPTIONS } from "@cocalc/util/nats";
import { callNatsService, createNatsService } from "@cocalc/nats/service";
import type {
  CallNatsServiceFunction,
  CreateNatsServiceFunction,
} from "@cocalc/nats/service";
import { listingsClient } from "@cocalc/nats/service/listings";
import {
  computeServerManager,
  type Options as ComputeServerManagerOptions,
} from "@cocalc/nats/compute/manager";
import getTime, { getSkew } from "@cocalc/nats/time";
import { llm } from "@cocalc/nats/llm/client";
import { inventory } from "@cocalc/nats/sync/inventory";
import { EventEmitter } from "events";

export class NatsClient extends EventEmitter {
  client: WebappClient;
  private sc = nats.StringCodec();
  private jc = nats.JSONCodec();
  private nc?: Awaited<ReturnType<typeof nats.connect>>;
  public nats = nats;
  public jetstream = jetstream;
  public hub: HubApi;
  public sessionId = randomId();
  private openFilesCache: { [project_id: string]: OpenFiles } = {};

  constructor(client: WebappClient) {
    super();
    this.setMaxListeners(100);
    this.client = client;
    this.hub = initHubApi(this.callHub);
    this.initBrowserApi();
  }

  private initBrowserApi = async () => {
    // have to delay so that this.client is fully created.
    await delay(1);
    try {
      await initApi();
    } catch (err) {
      console.warn("ERROR -- failed to initialize browser api", err);
    }
  };

  getConnection = reuseInFlight(async () => {
    if (this.nc != null) {
      // undocumented API
      if ((this.nc as any).protocol?.isClosed?.()) {
        // cause a reconnect.
        delete this.nc;
        this.setConnectionState("disconnected");
      } else {
        return this.nc;
      }
    }
    const server = `${location.protocol == "https:" ? "wss" : "ws"}://${location.host}${join(appBasePath, "nats")}`;
    console.log(`NATS: connecting to ${server}...`);
    const options = {
      ...CONNECT_OPTIONS,
      servers: [server],
      inboxPrefix: inboxPrefix({ account_id: this.client.account_id }),
    };
    try {
      this.nc = await nats.connect(options);
    } catch (err) {
      console.log("NATS: set the JWT cookie and try again");
      await fetch(join(appBasePath, "nats"));
      this.nc = await nats.connect(options);
    }
    console.log(`NATS: connected to ${server}`);
    this.monitorConnectionStatus(this.nc);
    return this.nc;
  });

  private setConnectionState = (
    state: "connected" | "connecting" | "disconnected",
  ) => {
    this.emit(state);
    const page = redux?.getActions("page");
    if (page == null) {
      return;
    }
    page.setState({
      nats: {
        state,
        data: this.natsDataTransfer(),
      },
    } as any);
  };

  private monitorConnectionStatus = async (nc) => {
    this.setConnectionState("connected");
    for await (const { type } of nc.status()) {
      if (type.includes("ping") || type == "update" || type == "reconnect") {
        // connection is working well
        this.setConnectionState("connected");
      } else if (type == "reconnecting") {
        this.setConnectionState("connecting");
      }
    }
  };

  private natsDataTransfer = (): {
    inBytes?: number;
    inMsgs?: number;
    outBytes?: number;
    outMsgs?: number;
  } => {
    // @ts-ignore: undocumented API
    const { inBytes, inMsgs, outBytes, outMsgs } = this.nc?.protocol ?? {};
    return { inBytes, inMsgs, outBytes, outMsgs };
  };

  callNatsService: CallNatsServiceFunction = async (options) => {
    return await callNatsService({ ...options, env: await this.getEnv() });
  };

  createNatsService: CreateNatsServiceFunction = async (options) => {
    return createNatsService({ ...options, env: await this.getEnv() });
  };

  // deprecated!
  projectWebsocketApi = async ({ project_id, mesg, timeout = 5000 }) => {
    const nc = await this.getConnection();
    const subject = projectSubject({ project_id, service: "browser-api" });
    const resp = await nc.request(subject, this.jc.encode(mesg), {
      timeout,
    });
    return this.jc.decode(resp.data);
  };

  private callHub = async ({
    service = "api",
    name,
    args = [],
    timeout = 5000,
  }: {
    service?: string;
    name: string;
    args: any[];
    timeout?: number;
  }) => {
    const nc = await this.getConnection();
    const subject = `hub.account.${this.client.account_id}.${service}`;
    try {
      const resp = await nc.request(
        subject,
        this.jc.encode({
          name,
          args,
        }),
        { timeout },
      );
      return this.jc.decode(resp.data);
    } catch (err) {
      err.message = `${err.message} - callHub: subject='${subject}', name='${name}', `;
      throw err;
    }
  };

  // Returns api for RPC calls to the project with typescript support!
  projectApi = ({
    project_id,
    compute_server_id = 0,
    timeout,
  }: {
    project_id: string;
    compute_server_id?: number;
    timeout?: number;
  }): ProjectApi => {
    if (!isValidUUID(project_id)) {
      throw Error(`project_id = '${project_id}' must be a valid uuid`);
    }
    const callProjectApi = async ({ name, args }) => {
      return await this.callProject({
        project_id,
        compute_server_id,
        timeout,
        service: "api",
        name,
        args,
      });
    };
    return initProjectApi(callProjectApi);
  };

  private callProject = async ({
    service = "api",
    project_id,
    compute_server_id,
    name,
    args = [],
    timeout = 5000,
  }: {
    service?: string;
    project_id: string;
    compute_server_id?: number;
    name: string;
    args: any[];
    timeout?: number;
  }) => {
    const nc = await this.getConnection();
    const subject = projectSubject({ project_id, compute_server_id, service });
    const mesg = this.jc.encode({
      name,
      args,
    });
    let resp;
    try {
      resp = await nc.request(subject, mesg, { timeout });
    } catch (err) {
      if (err.code == "PERMISSIONS_VIOLATION") {
        // request update of our credentials to include this project, then try again
        await this.hub.projects.addProjectPermission({ project_id });
        resp = await nc.request(subject, mesg, { timeout });
      } else {
        throw err;
      }
    }
    return this.jc.decode(resp.data);
  };

  private callBrowser = async ({
    service = "api",
    sessionId,
    name,
    args = [],
    timeout = 5000,
  }: {
    service?: string;
    sessionId: string;
    name: string;
    args: any[];
    timeout?: number;
  }) => {
    const nc = await this.getConnection();
    const subject = browserSubject({
      account_id: this.client.account_id,
      sessionId,
      service,
    });
    const mesg = this.jc.encode({
      name,
      args,
    });
    // console.log("request to subject", { subject, name, args });
    const resp = await nc.request(subject, mesg, { timeout });
    return this.jc.decode(resp.data);
  };

  browserApi = ({
    sessionId,
    timeout,
  }: {
    sessionId: string;
    timeout?: number;
  }): BrowserApi => {
    const callBrowserApi = async ({ name, args }) => {
      return await this.callBrowser({
        sessionId,
        timeout,
        service: "api",
        name,
        args,
      });
    };
    return initBrowserApi(callBrowserApi);
  };

  request = async (subject: string, data: string) => {
    const c = await this.getConnection();
    const resp = await c.request(subject, this.sc.encode(data));
    return this.sc.decode(resp.data);
  };

  consumer = async (stream: string) => {
    const js = jetstream.jetstream(await this.getConnection());
    return await js.consumers.get(stream);
  };

  getEnv = async () => {
    return {
      sha1,
      jc: this.jc,
      nc: await this.getConnection(),
    };
  };

  synctable: NatsSyncTableFunction = async (
    query,
    options?,
  ): Promise<NatsSyncTable> => {
    query = parse_query(query);
    const table = keys(query)[0];
    const obj = options?.obj;
    if (obj != null) {
      for (const k in obj) {
        query[table][0][k] = obj[k];
      }
    }
    if (options?.project_id != null && query[table][0]["project_id"] === null) {
      query[table][0]["project_id"] = options.project_id;
    }
    const s = createSyncTable({
      ...options,
      query,
      env: await this.getEnv(),
      account_id: this.client.account_id,
    });
    await s.init();
    return s;
  };

  changefeedInterest = async (query, noError?: boolean) => {
    // express interest
    // (re-)start changefeed going
    try {
      await this.client.nats_client.callHub({
        service: "db",
        name: "userQuery",
        args: [{ changes: true, query }],
      });
    } catch (err) {
      if (noError) {
        console.warn("changefeedInterest -- error", query);
        console.warn(err);
        return;
      } else {
        throw err;
      }
    }
  };

  changefeed = async (query, options?) => {
    this.changefeedInterest(query, true);
    return await this.synctable(query, options);
  };

  // DEPRECATED
  primus = async (project_id: string) => {
    return getPrimusConnection({
      subject: projectSubject({
        project_id,
        compute_server_id: 0,
        service: "primus",
      }),
      env: await this.getEnv(),
      role: "client",
      id: this.sessionId,
    });
  };

  openFiles = reuseInFlight(async (project_id: string) => {
    if (this.openFilesCache[project_id] == null) {
      const openFiles = await createOpenFiles({
        project_id,
        env: await this.getEnv(),
      });
      this.openFilesCache[project_id] = openFiles;
      openFiles.on("closed", () => {
        delete this.openFilesCache[project_id];
      });
      openFiles.on("change", (entry) => {
        if (entry.deleted?.deleted) {
          setDeleted({
            project_id,
            path: entry.path,
            deleted: entry.deleted.time,
          });
        } else {
          setNotDeleted({ project_id, path: entry.path });
        }
      });
      const recentlyDeletedPaths: any = {};
      for (const { path, deleted } of openFiles.getAll()) {
        if (deleted?.deleted) {
          recentlyDeletedPaths[path] = deleted.time;
        }
      }
      const store = redux.getProjectStore(project_id);
      store.setState({ recentlyDeletedPaths });
    }
    return this.openFilesCache[project_id]!;
  });

  pubsub = async ({
    project_id,
    path,
    name,
  }: {
    project_id: string;
    path?: string;
    name: string;
  }) => {
    return new PubSub({ project_id, path, name, env: await this.getEnv() });
  };

  // Evaluate an llm.  This streams the result if stream is given an option,
  // AND it also always returns the result.
  llm = async (opts: ChatOptions): Promise<string> => {
    return await llm({ account_id: this.client.account_id, ...opts });
  };

  stream = async <T = any,>(
    opts: Partial<UserStreamOptions> & { name: string },
  ): Promise<Stream<T>> => {
    if (!opts.account_id && !opts.project_id && opts.limits != null) {
      throw Error("account client can't set limits on public stream");
    }
    return await stream<T>({ env: await this.getEnv(), ...opts });
  };

  dstream = async <T = any,>(
    opts: Partial<UserStreamOptions> & { name: string },
  ): Promise<DStream<T>> => {
    if (!opts.account_id && !opts.project_id && opts.limits != null) {
      throw Error("account client can't set limits on public stream");
    }
    return await dstream<T>({ env: await this.getEnv(), ...opts });
  };

  kv = async <T = any,>(
    opts: Partial<KVOptions> & { name: string },
  ): Promise<KV<T>> => {
    //     if (!opts.account_id && !opts.project_id && opts.limits != null) {
    //       throw Error("account client can't set limits on public stream");
    //     }
    return await kv<T>({ env: await this.getEnv(), ...opts });
  };

  dkv = async <T = any,>(
    opts: Partial<DKVOptions> & { name: string },
  ): Promise<DKV<T>> => {
    //     if (!opts.account_id && !opts.project_id && opts.limits != null) {
    //       throw Error("account client can't set limits on public stream");
    //     }
    return await dkv<T>({ env: await this.getEnv(), ...opts });
  };

  dko = async <T = any,>(
    opts: Partial<DKOOptions> & { name: string },
  ): Promise<DKO<T>> => {
    //     if (!opts.account_id && !opts.project_id && opts.limits != null) {
    //       throw Error("account client can't set limits on public stream");
    //     }
    return await dko<T>({ env: await this.getEnv(), ...opts });
  };

  microservices = async () => {
    const nc = await this.getConnection();
    // @ts-ignore
    const svcm = new Svcm(nc);
    return svcm.client();
  };

  listings = async (opts: {
    project_id: string;
    compute_server_id?: number;
  }) => {
    return await listingsClient(opts);
  };

  computeServerManager = async (options: ComputeServerManagerOptions) => {
    const M = computeServerManager(options);
    await M.init();
    return M;
  };

  getTime = (): number => {
    return getTime();
  };

  getSkew = async (): Promise<number> => {
    return await getSkew();
  };

  inventory = async (location: {
    account_id?: string;
    project_id?: string;
  }) => {
    const inv = await inventory(location);
    // @ts-ignore
    if (console.log_original != null) {
      const ls_orig = inv.ls;
      // @ts-ignore
      inv.ls = (opts) => ls_orig({ ...opts, log: console.log_original });
    }
    return inv;
  };
}

function setDeleted({ project_id, path, deleted }) {
  if (!redux.hasProjectStore(project_id)) {
    return;
  }
  const actions = redux.getProjectActions(project_id);
  actions.setRecentlyDeleted(path, deleted);
}

function setNotDeleted({ project_id, path }) {
  if (!redux.hasProjectStore(project_id)) {
    return;
  }
  const actions = redux.getProjectActions(project_id);
  actions.setRecentlyDeleted(path, 0);
}

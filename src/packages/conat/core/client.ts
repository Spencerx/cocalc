/*
core/client.s -- core conat client

This is a client that has a similar API to NATS / Socket.io, but is much,
much better in so many ways:

- It has global pub/sub just like with NATS. This uses the server to
  rebroadcast messages, and for authentication.
    Better than NATS: Authentication is done for a subject *as
    needed* instead of at connection time.

- Message can be arbitrarily large and they are *automatically* divided
  into chunks and reassembled.   Better than both NATS and socket.io.

- There are multiple supported ways of encoding messages, and
  no coordination is required with the server or other clients!  E.g.,
  one message can be sent with one encoding and the next with a different
  encoding and that's fine.
     - MsgPack: https://msgpack.org/ -- a very compact encoding that handles
       dates nicely and small numbers efficiently.  This also works
       well with binary Buffer objects, which is nice.
     - JsonCodec: uses JSON.stringify and TextEncoder.  This does not work
       with Buffer or Date and is less compact, but can be very fast.


THE CORE API

This section contains the crucial information you have to know to build a distributed
system using Conat.   It's our take on the NATS primitives (it's not exactly the
same, but it is close).  It's basically a symmetrical pub/sub/reqest/respond model
for messaging on which you can build distributed systems.  The tricky part, which
NATS.js gets wrong (in my opinion), is implementing  this in a way that is robust
and scalable, in terms for authentication, real world browser connectivity and
so on.  Our approach is to use proven mature technology like socket.io, sqlite
and valkey, instead of writing everything from scratch.

Clients: We view all clients as plugged into a common "dial tone",
except for optional permissions that are configured when starting the server.
The methods you call on the client to build everything are:

 - subscribe, subscribeSync - subscribe to a subject which returns an
   async iterator over all messages that match the subject published by
   anyone with permission to do so.   If you provide the same optional
   queue parameter for multiple subscribers, then one subscriber in each queue
   group receives each message. The async form of this functino confirms
   the subscription was created before returning. If a client creates multiple
   subscriptions at the same time, the queue group must be the same.
   Subscriptions are guaranteed to stay valid until the client ends them;
   they do not stop working due to client or server reconnects or restarts.
   (If you need more subscriptions with different queue groups, make another
   client object.)

 - publish, publishSync - publish to a subject. The async version returns
   a count of the number of recipients, whereas the sync version is
   fire-and-forget.
   **There is no a priori size limit on messages since chunking
     is automatic.  However, we have to impose some limit, but
     it can be much larger than the socketio message size limit.**

 - request - send a message to a subject, and if there is at least one
   subscriber listening, it may respond.  If there are no subscribers,
   it throws a 503 error.  To create a microservice, subscribe
   to a subject pattern and called mesg.respond(...) on each message you
   receive.

 - requestMany - send a message to a subject, and receive many
   messages in reply.   Typically you end the response stream by sending
   a null message, but what you do is up to you.  This is very useful
   for streaming arbitrarily large data, long running changefeeds, LLM
   responses, etc.


Messages:  A message mesg is:

 - Data:
   - subject  - the subject the message was sent to
   - encoding - usually MessagePack
   - raw      - encoded binary data
   - headers  - a JSON-able Javascript object.

 - Methods:
   - data: this is a property, so if you do mesg.data, then it decodes raw
     and returns the resulting Javascript object.
   - respond, respondSync: if REPLY_HEADER is set, calling this publishes a
     respond message to the original sender of the message.


Persistence:

We also implement persistent streams, where you can also set a key.  This can
be used to build the analogue of Jetstream's streams and kv stores.  The object
store isn't necessary since there is no limit on message size.  Conat's persistent
streams are compressed by default and backed by individual sqlite files, which
makes them very memory efficient and it is easy to tier storage to cloud storage.

UNIT TESTS: See packages/server/conat/test/core

MISC NOTES:

NOTE: There is a socketio msgpack parser, but it just doesn't
work at all, which is weird.  Also, I think it's impossible to
do the sort of chunking we want at the level of a socket.io
parser -- it's just not possible in that the encoding.  We customize
things purely client side without using a parser, and get a much
simpler and better result, inspired by how NATS approaches things
with opaque messages.


SUBSCRIPTION ROBUSTNESS: When you call client.subscribe(...) you get back an async iterator.
It ONLY ends when you explicitly do the standard ways of terminating
such an iterator, including calling .close() on it.  It is a MAJOR BUG
if it were to terminate for any other reason.  In particular, the subscription
MUST NEVER throw an error or silently end when the connection is dropped
then resumed, or the server is restarted, or the client connects to
a different server!  These situations can, of course, result in missing
some messages, but that's understood.  There are no guarantees at all with
a subscription that every message is received.  That said, we have enabled
connectionStateRecovery (and added special conat support for it) so no messages
are dropped for temporary disconnects, even up to several minutes,
and even in valkey cluster mode!  Finally, any time a client disconnects
and reconnects, the client ensures that all subscriptions exist for it on the server
via a sync process.

Subscription robustness is a major difference with NATS.js, which would
mysteriously terminate subscriptions for a variety of reasons, meaning that any
code using subscriptions had to be wrapped in ugly complexity to be
usable in production.

USAGE:

The following should mostly work to interactively play around with this
code and develop it.  It's NOT automatically tested and depends on your
environment though, so may break.  See the unit tests in

        packages/server/conat/test/core/

for something that definitely works perfectly.


For developing at the command line, cd to packages/backend, then in node:

   c = require('@cocalc/backend/conat/conat').connect()

or

   c = require('@cocalc/conat/core/client').connect('http://localhost:3000')

   c.watch('a')

   s = await c.subscribe('a');  for await (const x of s) { console.log(x.length)}

// in another console

   c = require('@cocalc/backend/conat/conat').connect()
   c.publish('a', 'hello there')

// in browser (right now)

   cc.conat.conat()

// client server:

   s = await c.subscribe('eval'); for await(const x of s) { x.respond(eval(x.data)) }

then in another console

   f = async () => (await c.request('eval', '2+3')).data
   await f()

   t = Date.now(); for(i=0;i<1000;i++) { await f()} ; Date.now()-t

// slower, but won't silently fail due to errors, etc.

   f2 = async () => (await c.request('eval', '2+3', {confirm:true})).data

Wildcard subject:


   c = require('@cocalc/conat/core/client').connect(); c.watch('a.*');


   c = require('@cocalc/conat/core/client').connect(); c.publish('a.x', 'foo')


Testing disconnect

   c.sub('>')
   c.conn.io.engine.close();0;

other:

  a=0; setInterval(()=>c.pub('a',a++), 250)

*/

import {
  connect as connectToSocketIO,
  type SocketOptions,
  type ManagerOptions,
} from "socket.io-client";
import { EventIterator } from "@cocalc/util/event-iterator";
import type { ConnectionStats, ServerInfo } from "./types";
import * as msgpack from "@msgpack/msgpack";
import { randomId } from "@cocalc/conat/names";
import type { JSONValue } from "@cocalc/util/types";
import { EventEmitter } from "events";
import { callback } from "awaiting";
import {
  isValidSubject,
  isValidSubjectWithoutWildcards,
} from "@cocalc/conat/util";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";
import { once, until } from "@cocalc/util/async-utils";
import { delay } from "awaiting";
import { getLogger } from "@cocalc/conat/client";
import { refCacheSync } from "@cocalc/util/refcache";
import { join } from "path";
import { dko, type DKO } from "@cocalc/conat/sync/dko";
import { dkv, type DKVOptions, type DKV } from "@cocalc/conat/sync/dkv";
import {
  dstream,
  type DStreamOptions,
  type DStream,
} from "@cocalc/conat/sync/dstream";
import { akv, type AKV } from "@cocalc/conat/sync/akv";
import { astream, type AStream } from "@cocalc/conat/sync/astream";
import TTL from "@isaacs/ttlcache";
import {
  ConatSocketServer,
  ConatSocketClient,
  ServerSocket,
  type SocketConfiguration,
} from "@cocalc/conat/socket";
export { type ConatSocketServer, ConatSocketClient, ServerSocket };
import {
  type SyncTableOptions,
  type ConatSyncTable,
  createSyncTable,
} from "@cocalc/conat/sync/synctable";

export const MAX_INTEREST_TIMEOUT = 90000;

const MSGPACK_ENCODER_OPTIONS = {
  // ignoreUndefined is critical so database queries work properly, and
  // also we have a lot of api calls with tons of wasted undefined values.
  ignoreUndefined: true,
};

export const STICKY_QUEUE_GROUP = "sticky";

export const DEFAULT_SOCKETIO_CLIENT_OPTIONS = {
  // A major problem if we allow long polling is that we must always use at most
  // half the chunk size... because there is no way to know if recipients will be
  // using long polling to RECEIVE messages.  Not insurmountable.
  transports: ["websocket"],

  // nodejs specific for project/compute server in some settings
  rejectUnauthorized: false,

  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 15000,
  reconnectionAttempts: 9999999999, // infinite
};

type State = "disconnected" | "connected" | "closed";

const logger = getLogger("core/client");

interface Options {
  // address = the address of a cocalc server, including the base url, e.g.,
  //
  //   https://cocalc.com
  //
  // or for a dev server running locally with a base url:
  //
  //   http://localhost:4043/3fa218e5-7196-4020-8b30-e2127847cc4f/port/5002
  //
  // The socketio path is always /conat (after the base url) and is set automatically.
  //
  address?: string;
  inboxPrefix?: string;
}

export type ClientOptions = Options & {
  noCache?: boolean;
} & Partial<SocketOptions> &
  Partial<ManagerOptions>;

const INBOX_PREFIX = "_INBOX";
const REPLY_HEADER = "CN-Reply";
const MAX_HEADER_SIZE = 100000;

const STATS_LOOP = 5000;

export let DEFAULT_REQUEST_TIMEOUT = 7500;
export let DEFAULT_PUBLISH_TIMEOUT = 7500;

export function setDefaultTimeouts({
  request = DEFAULT_REQUEST_TIMEOUT,
  publish = DEFAULT_PUBLISH_TIMEOUT,
}: {
  request?: number;
  publish?: number;
}) {
  DEFAULT_REQUEST_TIMEOUT = request;
  DEFAULT_PUBLISH_TIMEOUT = publish;
}

export enum DataEncoding {
  MsgPack = 0,
  JsonCodec = 1,
}

interface SubscriptionOptions {
  maxWait?: number;
  mesgLimit?: number;
  queue?: string;
  // sticky: when a choice from a queue group is made, the same choice is always made
  // in the future for any message with subject matching subject with the last segment
  // replaced by a *, until the target goes away. Setting this just sets the queue
  // option to STICKY_QUEUE_GROUP.
  //
  // Examples of subjects matching except possibly last segment are
  //             foo.bar.lJcBSieLn and foo.bar.ZzsDC376ge
  // You can put anything random in the last segment and all messages
  // that match foo.bar.* get the same choice from the queue group.
  // The idea is that *when* the message with subject foo.bar.lJcBSieLn gets
  // sent, the backend server selects a target from the queue group to receive
  // that message.  It remembers the choice, and so long as that target is subscribed,
  // it sends any message matching foo.bar.* to that same target.
  // This is used in our implementation of persistent socket connections that
  // are built on pub/sub.  The underlying implementation uses consistent
  // hashing and messages to sync state of the servers.
  sticky?: boolean;
  respond?: Function;
  timeout?: number;
}

// WARNING!  This is the default and you can't just change it!
// Yes, for specific messages you can, but in general DO NOT.  The reason is because, e.g.,
// JSON will turn Dates into strings, and we no longer fix that.  So unless you modify the
// JsonCodec to handle Date's properly, don't change this!!
const DEFAULT_ENCODING = DataEncoding.MsgPack;

function cocalcServerToSocketioAddress(url?: string): {
  address: string;
  path: string;
} {
  url = url ?? process.env.CONAT_SERVER;
  if (!url) {
    throw Error(
      "Must give Conat server address or set CONAT_SERVER environment variable",
    );
  }
  const u = new URL(url, "http://dummy.org");
  const address = u.origin;
  const path = join(u.pathname, "conat");
  return { address, path };
}

const cache = refCacheSync<ClientOptions, Client>({
  name: "conat-client",
  createObject: (opts: ClientOptions) => {
    return new Client(opts);
  },
});

export function connect(opts: ClientOptions = {}) {
  if (!opts.address) {
    const x = cache.one();
    if (x != null) {
      return x;
    }
  }
  return cache(opts);
}

// Get any cached client, if there is one; otherwise make one
// with default options.
export function getClient() {
  return cache.one() ?? connect();
}

export class Client extends EventEmitter {
  public conn: ReturnType<typeof connectToSocketIO>;
  // queueGroups is a map from subject to the queue group for the subscription to that subject
  private queueGroups: { [subject: string]: string } = {};
  private subs: { [subject: string]: SubscriptionEmitter } = {};
  private sockets: {
    // all socket servers created using this Client
    servers: { [subject: string]: ConatSocketServer };
    // all client connections created using this Client.
    clients: { [subject: string]: { [id: string]: ConatSocketClient } };
  } = { servers: {}, clients: {} };
  private readonly options: ClientOptions;
  private inboxSubject: string;
  private inbox?: EventEmitter;
  private permissionError = {
    pub: new TTL<string, string>({ ttl: 1000 * 60 }),
    sub: new TTL<string, string>({ ttl: 1000 * 60 }),
  };
  public info: ServerInfo | undefined = undefined;
  // total number of
  public readonly stats: ConnectionStats & {
    recv0: { messages: number; bytes: number };
  } = {
    send: { messages: 0, bytes: 0 },
    recv: { messages: 0, bytes: 0 },
    // recv0 = count since last connect
    recv0: { messages: 0, bytes: 0 },
    subs: 0,
  };

  public readonly id: string = randomId();
  public state: State = "disconnected";

  constructor(options: ClientOptions) {
    super();
    this.setMaxListeners(1000);
    this.options = options;

    // for socket.io the address has no base url
    const { address, path } = cocalcServerToSocketioAddress(
      this.options.address,
    );
    logger.debug(`Conat: Connecting to ${this.options.address}...`);
    //     if (options.extraHeaders == null) {
    //       console.trace("WARNING: no auth set");
    //     }
    this.conn = connectToSocketIO(address, {
      ...DEFAULT_SOCKETIO_CLIENT_OPTIONS,
      ...options,
      path,
    });

    this.conn.on("info", (info) => {
      const firstTime = this.info == null;
      this.info = info;
      this.emit("info", info);
      setTimeout(this.syncSubscriptions, firstTime ? 3000 : 0);
    });
    this.conn.on("permission", ({ message, type, subject }) => {
      logger.debug(message);
      this.permissionError[type]?.set(subject, message);
    });
    this.conn.on("connect", async () => {
      logger.debug(`Conat: Connected to ${this.options.address}`);
      if (this.conn.connected) {
        this.setState("connected");
      }
    });
    this.conn.io.on("error", (...args) => {
      logger.debug(
        `Conat: Error connecting to ${this.options.address} -- `,
        ...args,
      );
    });
    this.conn.on("disconnect", () => {
      this.stats.recv0 = { messages: 0, bytes: 0 }; // reset on disconnect
      this.setState("disconnected");
      this.disconnectAllSockets();
    });
    this.initInbox();
    this.statsLoop();
  }

  disconnect = () => {
    this.disconnectAllSockets();
    // @ts-ignore
    setTimeout(() => this.conn.io.disconnect(), 1);
  };

  waitUntilSignedIn = reuseInFlight(async () => {
    // not "signed in" if --
    //   - not connected, or
    //   - no info at all (which gets sent on sign in)
    //   - or the user is {error:....}, which is what happens when sign in fails
    //     e.g., do to an expired cookie
    if (
      this.info == null ||
      this.state != "connected" ||
      this.info?.user?.error
    ) {
      await once(this, "info");
    }
  });

  private statsLoop = async () => {
    await until(
      async () => {
        if (this.isClosed()) {
          return true;
        }
        try {
          await this.waitUntilConnected();
          if (this.isClosed()) {
            return true;
          }
          this.conn.emit("stats", { recv0: this.stats.recv0 });
        } catch {}
        return false;
      },
      { start: STATS_LOOP, max: STATS_LOOP },
    );
  };

  interest = async (subject: string): Promise<boolean> => {
    return await this.waitForInterest(subject, { timeout: 0 });
  };

  waitForInterest = async (
    subject: string,
    {
      timeout = MAX_INTEREST_TIMEOUT,
    }: {
      timeout?: number;
    } = {},
  ) => {
    if (!isValidSubjectWithoutWildcards(subject)) {
      throw Error(
        `subject ${subject} must be a valid subject without wildcards`,
      );
    }
    timeout = Math.min(timeout, MAX_INTEREST_TIMEOUT);
    const f = (cb) => {
      this.conn
        .timeout(timeout ? timeout : 10000)
        .emit("wait-for-interest", { subject, timeout }, (err, response) => {
          if (err) {
            cb(err);
          } else if (response.error) {
            cb(new ConatError(response.error, { code: response.code }));
          } else {
            cb(undefined, response);
          }
        });
    };
    return await callback(f);
  };

  recvStats = (bytes: number) => {
    this.stats.recv.messages += 1;
    this.stats.recv.bytes += bytes;
    this.stats.recv0.messages += 1;
    this.stats.recv0.bytes += bytes;
  };

  // There should usually be no reason to call this because socket.io
  // is so good at abstracting this away. It's useful for unit testing.
  waitUntilConnected = reuseInFlight(async () => {
    if (this.conn.connected) {
      return;
    }
    // @ts-ignore
    await once(this.conn, "connect");
  });

  waitUntilReady = reuseInFlight(async () => {
    await this.waitUntilSignedIn();
    await this.waitUntilConnected();
  });

  private setState = (state: State) => {
    if (this.isClosed() || this.state == state) {
      return;
    }
    this.state = state;
    this.emit(state);
  };

  private temporaryInboxSubject = () => {
    if (!this.inboxSubject) {
      throw Error("inbox not setup properly");
    }
    return `${this.inboxSubject}.${randomId()}`;
  };

  private getInbox = reuseInFlight(async (): Promise<EventEmitter> => {
    if (this.inbox == null) {
      if (this.isClosed()) {
        throw Error("closed");
      }
      await once(this, "inbox");
    }
    if (this.inbox == null) {
      throw Error("bug");
    }
    return this.inbox;
  });

  private initInbox = async () => {
    // For request/respond instead of setting up one
    // inbox *every time there is a request*, we setup a single
    // inbox once and for all for all responses.  We listen for
    // everything to inbox...Prefix.* and emit it via this.inbox.
    // The request sender then listens on this.inbox for the response.
    // We *could* use a regular subscription for each request,
    // but (1) that massively increases the load on the server for
    // every single request (having to create and destroy subscriptions)
    // and (2) there is a race condition between creating that subscription
    // and getting the response; it's fine with one server, but with
    // multiple servers solving the race condition would slow everything down
    // due to having to wait for so many acknowledgements.  Instead, we
    // remove all those problems by just using a single inbox subscription.
    const inboxPrefix = this.options.inboxPrefix ?? INBOX_PREFIX;
    if (!inboxPrefix.startsWith(INBOX_PREFIX)) {
      throw Error(`custom inboxPrefix must start with '${INBOX_PREFIX}'`);
    }
    this.inboxSubject = `${inboxPrefix}.${randomId()}`;
    let sub;
    await until(
      async () => {
        try {
          await this.waitUntilSignedIn();
          sub = await this.subscribe(this.inboxSubject + ".*");
          return true;
        } catch (err) {
          if (this.isClosed()) {
            return true;
          }
          // this should only fail due to permissions issues, at which point
          // request can't work, but pub/sub can.
          console.log(`WARNING: inbox not available -- ${err}`);
        }
        return false;
      },
      { start: 1000, max: 15000 },
    );
    if (this.isClosed()) {
      return;
    }

    this.inbox = new EventEmitter();
    (async () => {
      for await (const mesg of sub) {
        if (this.inbox == null) {
          return;
        }
        this.inbox.emit(mesg.subject, mesg);
      }
    })();
    this.emit("inbox", this.inboxSubject);
  };

  private isClosed = () => {
    return this.state == "closed";
  };

  close = () => {
    if (this.isClosed()) {
      return;
    }
    this.setState("closed");
    this.removeAllListeners();
    this.closeAllSockets();
    // @ts-ignore
    delete this.sockets;
    for (const subject in this.queueGroups) {
      this.conn.emit("unsubscribe", { subject });
      delete this.queueGroups[subject];
    }
    for (const sub of Object.values(this.subs)) {
      sub.refCount = 0;
      sub.close();
      // @ts-ignore
      delete this.subs;
    }
    // @ts-ignore
    delete this.queueGroups;
    // @ts-ignore
    delete this.inboxSubject;
    delete this.inbox;
    // @ts-ignore
    delete this.options;
    // @ts-ignore
    delete this.info;
    // @ts-ignore
    delete this.permissionError;

    try {
      this.conn.close();
    } catch {}
  };

  private syncSubscriptions = reuseInFlight(async () => {
    let fails = 0;
    await until(
      async () => {
        if (this.isClosed()) return true;
        try {
          if (this.info == null) {
            // no point in trying until we are signed in and connected
            await once(this, "info");
          }
          if (this.isClosed()) return true;
          await this.waitUntilConnected();
          if (this.isClosed()) return true;
          const stable = await this.syncSubscriptions0(10000);
          if (stable) {
            return true;
          }
        } catch (err) {
          fails++;
          if (fails >= 3) {
            console.log(
              `WARNING: failed to sync subscriptions ${fails} times -- ${err}`,
            );
          }
        }
        return false;
      },
      { start: 1000, max: 15000 },
    );
  });

  // syncSubscriptions0 ensures that we're subscribed on server
  // to what we think we're subscribed to, or throws an error.
  private syncSubscriptions0 = async (timeout: number): Promise<boolean> => {
    if (this.isClosed()) return true;
    if (this.info == null) {
      throw Error("not signed in");
    }
    const subs = await this.getSubscriptions(timeout);
    //     console.log("syncSubscriptions", {
    //       server: subs,
    //       client: Object.keys(this.queueGroups),
    //     });
    const missing: { subject: string; queue: string }[] = [];
    for (const subject in this.queueGroups) {
      // subscribe on backend to all subscriptions we think we should have that
      // the server does not have
      if (!subs.has(subject)) {
        missing.push({
          subject,
          queue: this.queueGroups[subject],
        });
      }
    }
    let stable = true;
    if (missing.length > 0) {
      stable = false;
      const resp = await callback(
        this.conn.timeout(timeout).emit.bind(this.conn),
        "subscribe",
        missing,
      );
      // some subscription could fail due to permissions changes, e.g., user got
      // removed from a project.
      for (let i = 0; i < missing.length; i++) {
        if (resp[i].error) {
          const sub = this.subs[missing[i].subject];
          if (sub != null) {
            sub.close(true);
          }
        }
      }
    }
    const extra: { subject: string }[] = [];
    for (const subject in subs) {
      if (this.queueGroups[subject] != null) {
        // server thinks we're subscribed but we do not think so, so cancel that
        extra.push({ subject });
      }
    }
    if (extra.length > 0) {
      await callback(
        this.conn.timeout(timeout).emit.bind(this.conn),
        "unsubscribe",
        extra,
      );
      stable = false;
    }
    return stable;
  };

  numSubscriptions = () => Object.keys(this.queueGroups).length;

  private getSubscriptions = async (
    timeout = DEFAULT_REQUEST_TIMEOUT,
  ): Promise<Set<string>> => {
    const subs = await callback(
      this.conn.timeout(timeout).emit.bind(this.conn),
      "subscriptions",
      null,
    );
    return new Set(subs);
  };

  // returns EventEmitter that emits 'message', mesg: Message
  private subscriptionEmitter = (
    subject: string,
    {
      closeWhenOffCalled,
      queue,
      sticky,
      confirm,
      timeout,
    }: {
      // if true, when the off method of the event emitter is called, then
      // the entire subscription is closed. This is very useful when we wrap the
      // EvenEmitter in an async iterator.
      closeWhenOffCalled?: boolean;

      // the queue group -- if not given, then one is randomly assigned.
      queue?: string;

      // if true, sets queue to "sticky"
      sticky?: boolean;

      // confirm -- get confirmation back from server that subscription was created
      confirm?: boolean;

      // how long to wait to confirm creation of the subscription;
      // only used when confirm=true.
      timeout?: number;
    } = {},
  ): { sub: SubscriptionEmitter; promise? } => {
    if (this.isClosed()) {
      throw Error("closed");
    }
    if (!isValidSubject(subject)) {
      throw Error(`invalid subscribe subject '${subject}'`);
    }
    if (this.permissionError.sub.has(subject)) {
      const message = this.permissionError.sub.get(subject)!;
      logger.debug(message);
      throw new ConatError(message, { code: 403 });
    }
    if (sticky) {
      if (queue) {
        throw Error("must not specify queue group if sticky is true");
      }
      queue = STICKY_QUEUE_GROUP;
    }
    let sub = this.subs[subject];
    if (sub != null) {
      if (queue && this.queueGroups[subject] != queue) {
        throw Error(
          `client can only have one queue group subscription for a given subject -- subject='${subject}', queue='${queue}'`,
        );
      }
      if (queue == STICKY_QUEUE_GROUP) {
        throw Error(
          `can only have one sticky subscription per client -- subject='${subject}'`,
        );
      }
      sub.refCount += 1;
      return { sub, promise: undefined };
    }
    if (this.queueGroups[subject] != null) {
      throw Error(`already subscribed to '${subject}'`);
    }
    if (!queue) {
      queue = randomId();
    }
    this.queueGroups[subject] = queue;
    sub = new SubscriptionEmitter({
      client: this,
      subject,
      closeWhenOffCalled,
    });
    this.subs[subject] = sub;
    this.stats.subs++;
    let promise;
    if (confirm) {
      const f = (cb) => {
        const handle = (response) => {
          if (response?.error) {
            cb(new ConatError(response.error, { code: response.code }));
          } else {
            cb(response?.error, response);
          }
        };
        if (timeout) {
          this.conn
            .timeout(timeout)
            .emit("subscribe", { subject, queue }, (err, response) => {
              if (err) {
                handle({ error: `${err}`, code: 408 });
              } else {
                handle(response);
              }
            });
        } else {
          this.conn.emit("subscribe", { subject, queue }, handle);
        }
      };
      promise = callback(f);
    } else {
      this.conn.emit("subscribe", { subject, queue });
      promise = undefined;
    }
    sub.once("closed", () => {
      if (this.isClosed()) {
        return;
      }
      this.conn.emit("unsubscribe", { subject });
      delete this.queueGroups[subject];
      if (this.subs[subject] != null) {
        this.stats.subs--;
        delete this.subs[subject];
      }
    });
    return { sub, promise };
  };

  private subscriptionIterator = (
    sub,
    opts?: SubscriptionOptions,
  ): Subscription => {
    // @ts-ignore
    const iter = new EventIterator<Message>(sub, "message", {
      idle: opts?.maxWait,
      limit: opts?.mesgLimit,
      map: (args) => args[0],
    });
    return iter;
  };

  subscribeSync = (
    subject: string,
    opts?: SubscriptionOptions,
  ): Subscription => {
    const { sub } = this.subscriptionEmitter(subject, {
      confirm: false,
      closeWhenOffCalled: true,
      sticky: opts?.sticky,
      queue: opts?.queue,
    });
    return this.subscriptionIterator(sub, opts);
  };

  subscribe = async (
    subject: string,
    opts?: SubscriptionOptions,
  ): Promise<Subscription> => {
    await this.waitUntilSignedIn();
    const { sub, promise } = this.subscriptionEmitter(subject, {
      confirm: true,
      closeWhenOffCalled: true,
      queue: opts?.queue,
      sticky: opts?.sticky,
      timeout: opts?.timeout,
    });
    await promise;
    return this.subscriptionIterator(sub, opts);
  };

  sub = this.subscribe;

  /*
  A service is a subscription with a function to respond to requests by name.
  Call service with an implementation:

     service = await client1.service('arith',  {mul : async (a,b)=>{a*b}, add : async (a,b)=>a+b})

  Use the service:

     arith = await client2.call('arith')
     await arith.mul(2,3)
     await arith.add(2,3)

  There's by default a single queue group '0', so if you create multiple services on various
  computers, then requests are load balanced across them automatically.  Explicitly set
  a random queue group (or something else) and use callMany if you don't want this behavior.

  Close the service when done:

     service.close();

  See backend/conat/test/core/services.test.ts for a tested and working example
  that involves typescript and shows how to use wildcard subjects and get the
  specific subject used for a call by using that this is bound to the calling mesg.
  */
  service: <T = any>(
    subject: string,
    impl: T,
    opts?: SubscriptionOptions,
  ) => Promise<Subscription> = async (subject, impl, opts) => {
    const sub = await this.subscribe(subject, {
      ...opts,
      queue: opts?.queue ?? "0",
    });
    const respond = async (mesg: Message) => {
      try {
        const [name, args] = mesg.data;
        // call impl[name], but with 'this' set to the object {subject:...},
        // so inside the service, it is possible to know what subject was used
        // in the request, in case subject is a wildcard subject.
        //         const result = await impl[name].apply(
        //           { subject: mesg.subject },
        //           ...args,
        //         );
        //         const result = await impl[name].apply(
        //           { subject: mesg.subject },
        //           ...args,
        //         );
        //         mesg.respondSync(result);
        let f = impl[name];
        if (f == null) {
          throw Error(`${name} not defined`);
        }
        const result = await f.apply(mesg, args);
        mesg.respondSync(result);
      } catch (err) {
        mesg.respondSync(null, { headers: { error: `${err}` } });
      }
    };
    const loop = async () => {
      // todo -- param to set max number of responses at once.
      for await (const mesg of sub) {
        respond(mesg);
      }
    };
    loop();
    return sub;
  };

  // Call a service as defined above.
  call<T = any>(subject: string, opts?: PublishOptions): T {
    const call = async (name: string, args: any[]) => {
      const resp = await this.request(subject, [name, args], opts);
      if (resp.headers?.error) {
        throw Error(`${resp.headers.error}`);
      } else {
        return resp.data;
      }
    };

    return new Proxy(
      {},
      {
        get: (_, name) => {
          if (typeof name !== "string") {
            return undefined;
          }
          return async (...args) => await call(name, args);
        },
      },
    ) as T;
  }

  callMany<T = any>(subject: string, opts?: RequestManyOptions): T {
    const maxWait = opts?.maxWait ? opts?.maxWait : DEFAULT_REQUEST_TIMEOUT;
    const self = this;
    async function* callMany(name: string, args: any[]) {
      const sub = await self.requestMany(subject, [name, args], {
        ...opts,
        maxWait,
      });
      for await (const resp of sub) {
        if (resp.headers?.error) {
          yield new ConatError(`${resp.headers.error}`, {
            code: resp.headers.code,
          });
        } else {
          yield resp.data;
        }
      }
    }

    return new Proxy(
      {},
      {
        get: (_, name) => {
          if (typeof name !== "string") {
            return undefined;
          }
          return async (...args) => await callMany(name, args);
        },
      },
    ) as T;
  }

  publishSync = (
    subject: string,
    mesg,
    opts?: PublishOptions,
  ): { bytes: number } => {
    if (this.isClosed()) {
      // already closed
      return { bytes: 0 };
    }
    return this._publish(subject, mesg, opts);
  };

  publish = async (
    subject: string,
    mesg,
    opts?: PublishOptions,
  ): Promise<{
    // bytes encoded (doesn't count some extra wrapping)
    bytes: number;
    // count is the number of matching subscriptions
    // that the server *sent* this message to since the server knows about them.
    // However, there's no guaranteee that the subscribers actually exist
    // **right now** or received these messages.
    count: number;
  }> => {
    if (this.isClosed()) {
      // already closed
      return { bytes: 0, count: 0 };
    }
    await this.waitUntilSignedIn();
    const { bytes, getCount, promise } = this._publish(subject, mesg, {
      ...opts,
      confirm: true,
    });
    await promise;
    return { bytes, count: getCount?.()! };
  };

  private _publish = (
    subject: string,
    mesg,
    {
      headers,
      raw,
      encoding = DEFAULT_ENCODING,
      confirm,
      timeout = DEFAULT_PUBLISH_TIMEOUT,
    }: PublishOptions & { confirm?: boolean } = {},
  ) => {
    if (this.isClosed()) {
      return { bytes: 0 };
    }
    if (!isValidSubjectWithoutWildcards(subject)) {
      throw Error(`invalid publish subject ${subject}`);
    }
    if (this.permissionError.pub.has(subject)) {
      const message = this.permissionError.pub.get(subject)!;
      logger.debug(message);
      throw new ConatError(message, { code: 403 });
    }
    raw = raw ?? encode({ encoding, mesg });
    this.stats.send.messages += 1;
    this.stats.send.bytes += raw.length;

    // default to 1MB is safe since it's at least that big.
    const chunkSize = Math.max(
      1000,
      (this.info?.max_payload ?? 1e6) - MAX_HEADER_SIZE,
    );
    let seq = 0;
    let id = randomId();
    const promises: any[] = [];
    let count = 0;
    for (let i = 0; i < raw.length; i += chunkSize) {
      // !!FOR TESTING ONLY!!
      //       if (Math.random() <= 0.01) {
      //         console.log("simulating a chunk drop", { subject, seq });
      //         seq += 1;
      //         continue;
      //       }
      const done = i + chunkSize >= raw.length ? 1 : 0;
      const v: any[] = [
        subject,
        id,
        seq,
        done,
        encoding,
        raw.slice(i, i + chunkSize),
      ];
      if (done && headers) {
        v.push(headers);
      }
      if (confirm) {
        let done = false;
        const f = (cb) => {
          const handle = (response) => {
            // console.log("_publish", { done, subject, mesg, headers, confirm });
            if (response?.error) {
              cb(new ConatError(response.error, { code: response.code }));
            } else {
              cb(response?.error, response);
            }
          };
          if (timeout) {
            const timer = setTimeout(() => {
              done = true;
              cb(new ConatError("timeout", { code: 408 }));
            }, timeout);

            this.conn.timeout(timeout).emit("publish", v, (err, response) => {
              if (done) {
                return;
              }
              clearTimeout(timer);
              if (err) {
                handle({ error: `${err}`, code: 408 });
              } else {
                handle(response);
              }
            });
          } else {
            this.conn.emit("publish", v, handle);
          }
        };
        const promise = (async () => {
          const response = await callback(f);
          count = Math.max(count, response.count ?? 0);
        })();
        promises.push(promise);
      } else {
        this.conn.emit("publish", v);
      }
      seq += 1;
    }
    if (confirm) {
      return {
        bytes: raw.length,
        getCount: () => count,
        promise: Promise.all(promises),
      };
    }
    return { bytes: raw.length };
  };

  pub = this.publish;

  request = async (
    subject: string,
    mesg: any,
    {
      timeout = DEFAULT_REQUEST_TIMEOUT,
      // waitForInterest -- if publish fails due to no receivers and
      // waitForInterest is true, will wait until there is a receiver
      // and publish again:
      waitForInterest = false,
      ...options
    }: PublishOptions & { timeout?: number; waitForInterest?: boolean } = {},
  ): Promise<Message> => {
    if (timeout <= 0) {
      throw Error("timeout must be positive");
    }
    const start = Date.now();
    const inbox = await this.getInbox();
    const inboxSubject = this.temporaryInboxSubject();
    const sub = new EventIterator<Message>(inbox, inboxSubject, {
      idle: timeout,
      limit: 1,
      map: (args) => args[0],
    });

    const opts = {
      ...options,
      timeout,
      headers: { ...options?.headers, [REPLY_HEADER]: inboxSubject },
    };
    const { count } = await this.publish(subject, mesg, opts);

    if (!count) {
      const giveUp = () => {
        sub.stop();
        throw new ConatError(
          `request -- no subscribers matching '${subject}'`,
          {
            code: 503,
          },
        );
      };
      if (waitForInterest) {
        await this.waitForInterest(subject, { timeout });
        if (this.state == "closed") {
          throw Error("closed");
        }
        const remaining = timeout - (Date.now() - start);
        if (remaining <= 1000) {
          throw new ConatError("timeout", { code: 408 });
        }
        // no error so there is very likely now interest, so we publish again:
        const { count } = await this.publish(subject, mesg, {
          ...opts,
          timeout: remaining,
        });
        if (!count) {
          giveUp();
        }
      } else {
        giveUp();
      }
    }

    for await (const resp of sub) {
      sub.stop();
      return resp;
    }
    sub.stop();
    throw new ConatError("timeout", { code: 408 });
  };

  // NOTE: Using requestMany returns a Subscription sub, and
  // you can call sub.close().  However, the sender doesn't
  // know that this happened and the messages are still going
  // to your inbox.    Similarly if you set a maxWait, the
  // subscription just ends at that point, but the server
  // sending messages doesn't know.  This is a shortcoming the
  // pub/sub model.  You must decide entirely based on your
  // own application protocol how to terminate.
  requestMany = async (
    subject: string,
    mesg: any,
    { maxMessages, maxWait, ...options }: RequestManyOptions = {},
  ): Promise<Subscription> => {
    if (maxMessages != null && maxMessages <= 0) {
      throw Error("maxMessages must be positive");
    }
    if (maxWait != null && maxWait <= 0) {
      throw Error("maxWait must be positive");
    }
    const inbox = await this.getInbox();
    const inboxSubject = this.temporaryInboxSubject();
    const sub = new EventIterator<Message>(inbox, inboxSubject, {
      idle: maxWait,
      limit: maxMessages,
      map: (args) => args[0],
    });
    const { count } = await this.publish(subject, mesg, {
      ...options,
      headers: { ...options?.headers, [REPLY_HEADER]: inboxSubject },
    });
    if (!count) {
      sub.stop();
      throw new ConatError(
        `requestMany -- no subscribers matching ${subject}`,
        { code: 503 },
      );
    }
    return sub;
  };

  // watch: this is mainly for debugging and interactive use.
  watch = (
    subject: string,
    cb = (x) => console.log(`${new Date()}: ${x.subject}:`, x.data, x.headers),
    opts?: SubscriptionOptions,
  ) => {
    const sub = this.subscribeSync(subject, opts);
    const f = async () => {
      for await (const x of sub) {
        cb(x);
      }
    };
    f();
    return sub;
  };

  sync = {
    dkv: async (opts: DKVOptions): Promise<DKV> =>
      await dkv({ ...opts, client: this }),
    akv: async (opts: DKVOptions): Promise<AKV> =>
      await akv({ ...opts, client: this }),
    dko: async (opts: DKVOptions): Promise<DKO> =>
      await dko({ ...opts, client: this }),
    dstream: async (opts: DStreamOptions): Promise<DStream> =>
      await dstream({ ...opts, client: this }),
    astream: async (opts: DStreamOptions): Promise<AStream> =>
      await astream({ ...opts, client: this }),
    synctable: async (opts: SyncTableOptions): Promise<ConatSyncTable> =>
      await createSyncTable({ ...opts, client: this }),
  };

  socket = {
    listen: (
      subject: string,
      opts?: SocketConfiguration,
    ): ConatSocketServer => {
      if (this.state == "closed") {
        throw Error("closed");
      }
      if (this.sockets.servers[subject] !== undefined) {
        throw Error(
          `there can be at most one socket server per client listening on a subject (subject='${subject}')`,
        );
      }
      const server = new ConatSocketServer({
        subject,
        role: "server",
        client: this,
        id: this.id,
        ...opts,
      });
      this.sockets.servers[subject] = server;
      server.once("closed", () => {
        delete this.sockets.servers[subject];
      });
      return server;
    },

    connect: (
      subject: string,
      opts?: SocketConfiguration,
    ): ConatSocketClient => {
      if (this.state == "closed") {
        throw Error("closed");
      }
      const id = randomId();
      const client = new ConatSocketClient({
        subject,
        role: "client",
        client: this,
        id,
        ...opts,
      });
      if (this.sockets.clients[subject] === undefined) {
        this.sockets.clients[subject] = { [id]: client };
      } else {
        this.sockets.clients[subject][id] = client;
      }
      client.once("closed", () => {
        const v = this.sockets.clients[subject];
        if (v != null) {
          delete v[id];
          if (isEmpty(v)) {
            delete this.sockets.clients[subject];
          }
        }
      });
      return client;
    },
  };

  private disconnectAllSockets = () => {
    for (const subject in this.sockets.servers) {
      this.sockets.servers[subject].disconnect();
    }
    for (const subject in this.sockets.clients) {
      for (const id in this.sockets.clients[subject]) {
        this.sockets.clients[subject][id].disconnect();
      }
    }
  };

  private closeAllSockets = () => {
    for (const subject in this.sockets.servers) {
      this.sockets.servers[subject].close();
    }
    for (const subject in this.sockets.clients) {
      for (const id in this.sockets.clients[subject]) {
        this.sockets.clients[subject][id].close();
      }
    }
  };

  message = (mesg, options?) => messageData(mesg, options);
}

interface PublishOptions {
  headers?: Headers;
  // if encoding is given, it specifies the encoding used to encode the message
  encoding?: DataEncoding;
  // if raw is given, then it is assumed to be the raw binary
  // encoded message (using encoding) and any mesg parameter
  // is *IGNORED*.
  raw?;
  // timeout used when publishing a message and awaiting a response.
  timeout?: number;
}

interface RequestManyOptions extends PublishOptions {
  maxWait?: number;
  maxMessages?: number;
}

export function encode({
  encoding,
  mesg,
}: {
  encoding: DataEncoding;
  mesg: any;
}) {
  if (encoding == DataEncoding.MsgPack) {
    return msgpack.encode(mesg, MSGPACK_ENCODER_OPTIONS);
  } else if (encoding == DataEncoding.JsonCodec) {
    return jsonEncoder(mesg);
  } else {
    throw Error(`unknown encoding ${encoding}`);
  }
}

export function decode({
  encoding,
  data,
}: {
  encoding: DataEncoding;
  data;
}): any {
  if (encoding == DataEncoding.MsgPack) {
    return msgpack.decode(data);
  } else if (encoding == DataEncoding.JsonCodec) {
    return jsonDecoder(data);
  } else {
    throw Error(`unknown encoding ${encoding}`);
  }
}

let textEncoder: TextEncoder | undefined = undefined;
let textDecoder: TextDecoder | undefined = undefined;

function jsonEncoder(obj: any) {
  if (textEncoder === undefined) {
    textEncoder = new TextEncoder();
  }
  return textEncoder.encode(JSON.stringify(obj));
}

function jsonDecoder(data: Buffer): any {
  if (textDecoder === undefined) {
    textDecoder = new TextDecoder();
  }
  return JSON.parse(textDecoder.decode(data));
}

interface Chunk {
  id: string;
  seq: number;
  done: number;
  buffer: Buffer;
  headers?: any;
}

// if an incoming message has chunks at least this old
// we give up on it and discard all of them.  This avoids
// memory leaks when a chunk is dropped.
const MAX_CHUNK_TIME = 2 * 60000;

class SubscriptionEmitter extends EventEmitter {
  private incoming: { [id: string]: (Partial<Chunk> & { time: number })[] } =
    {};
  private client: Client;
  private closeWhenOffCalled?: boolean;
  private subject: string;
  public refCount: number = 1;

  constructor({ client, subject, closeWhenOffCalled }) {
    super();
    this.client = client;
    this.subject = subject;
    this.client.conn.on(subject, this.handle);
    this.closeWhenOffCalled = closeWhenOffCalled;
    this.dropOldLoop();
  }

  close = (force?) => {
    this.refCount -= 1;
    // console.log("SubscriptionEmitter.close - refCount =", this.refCount, this.subject);
    if (this.client == null || (!force && this.refCount > 0)) {
      return;
    }
    this.emit("closed");
    this.client.conn.removeListener(this.subject, this.handle);
    // @ts-ignore
    delete this.incoming;
    // @ts-ignore
    delete this.client;
    // @ts-ignore
    delete this.subject;
    // @ts-ignore
    delete this.closeWhenOffCalled;
    this.removeAllListeners();
  };

  off(a, b) {
    super.off(a, b);
    if (this.closeWhenOffCalled) {
      this.close();
    }
    return this;
  }

  private handle = ({ subject, data }) => {
    if (this.client == null) {
      return;
    }
    const [id, seq, done, encoding, buffer, headers] = data;
    // console.log({ id, seq, done, encoding, buffer, headers });
    const chunk = { seq, done, encoding, buffer, headers };
    const { incoming } = this;
    if (incoming[id] == null) {
      if (seq != 0) {
        // part of a dropped message -- by definition this should just
        // silently happen and be handled via application level encodings
        // elsewhere
        console.log(
          `WARNING: drop packet from ${this.subject} -- first message has wrong seq`,
          { seq },
        );
        return;
      }
      incoming[id] = [];
    } else {
      const prev = incoming[id].slice(-1)[0].seq ?? -1;
      if (prev + 1 != seq) {
        console.log(
          `WARNING: drop packet from ${this.subject} -- seq number wrong`,
          { prev, seq },
        );
        // part of message was dropped -- discard everything
        delete incoming[id];
        return;
      }
    }
    incoming[id].push({ ...chunk, time: Date.now() });
    if (chunk.done) {
      // console.log("assembling ", incoming[id].length, "chunks");
      const chunks = incoming[id].map((x) => x.buffer!);
      // TESTING ONLY!!
      // This is not necessary due to the above checks as messages arrive.
      //       for (let i = 0; i < incoming[id].length; i++) {
      //         if (incoming[id][i]?.seq != i) {
      //           console.log(`WARNING: bug -- invalid chunk data! -- ${subject}`);
      //           throw Error("bug -- invalid chunk data!");
      //         }
      //       }
      const raw = concatArrayBuffers(chunks);

      // TESTING ONLY!!
      //       try {
      //         decode({ encoding, data: raw });
      //       } catch (err) {
      //         console.log(`ERROR - invalid data ${subject}`, incoming[id], err);
      //       }

      delete incoming[id];
      const mesg = new Message({
        encoding,
        raw,
        headers,
        client: this.client,
        subject,
      });
      this.emit("message", mesg);
      this.client.recvStats(raw.byteLength);
    }
  };

  dropOldLoop = async () => {
    while (this.incoming != null) {
      const cutoff = Date.now() - MAX_CHUNK_TIME;
      for (const id in this.incoming) {
        const chunks = this.incoming[id];
        if (chunks.length > 0 && chunks[0].time <= cutoff) {
          console.log(
            `WARNING: drop partial message from ${this.subject} due to timeout`,
          );
          delete this.incoming[id];
        }
      }
      await delay(MAX_CHUNK_TIME / 2);
    }
  };
}

function concatArrayBuffers(buffers) {
  if (buffers.length == 1) {
    return buffers[0];
  }
  if (Buffer.isBuffer(buffers[0])) {
    return Buffer.concat(buffers);
  }
  // browser fallback
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  return result.buffer;
}

export type Headers = { [key: string]: JSONValue };

export class MessageData<T = any> {
  public readonly encoding: DataEncoding;
  public readonly raw;
  public readonly headers?: Headers;

  constructor({ encoding, raw, headers }) {
    this.encoding = encoding;
    this.raw = raw;
    this.headers = headers;
  }

  get data(): T {
    return decode({ encoding: this.encoding, data: this.raw });
  }

  get length(): number {
    // raw is binary data so it's the closest thing we have to the
    // size of this message.  It would also make sense to include
    // the headers, but JSON'ing them would be expensive, so we don't.
    return this.raw.length;
  }
}

export class Message<T = any> extends MessageData<T> {
  private client: Client;
  public readonly subject;

  constructor({ encoding, raw, headers, client, subject }) {
    super({ encoding, raw, headers });
    this.client = client;
    this.subject = subject;
  }

  isRequest = (): boolean => !!this.headers?.[REPLY_HEADER];

  private respondSubject = () => {
    const subject = this.headers?.[REPLY_HEADER];
    if (!subject) {
      console.log(
        `WARNING: respond -- message to '${this.subject}' is not a request`,
      );
      return;
    }
    return `${subject}`;
  };

  respondSync = (mesg, opts?: PublishOptions): { bytes: number } => {
    const subject = this.respondSubject();
    if (!subject) return { bytes: 0 };
    return this.client.publishSync(subject, mesg, opts);
  };

  respond = async (
    mesg,
    opts: PublishOptions = {},
  ): Promise<{ bytes: number; count: number }> => {
    const subject = this.respondSubject();
    if (!subject) {
      return { bytes: 0, count: 0 };
    }
    return await this.client.publish(subject, mesg, opts);
  };
}

export function messageData(
  mesg,
  { headers, raw, encoding = DEFAULT_ENCODING }: PublishOptions = {},
) {
  return new MessageData({
    encoding,
    raw: raw ?? encode({ encoding, mesg }),
    headers,
  });
}

export type Subscription = EventIterator<Message>;

export class ConatError extends Error {
  code: string | number;
  constructor(mesg: string, { code }) {
    super(mesg);
    this.code = code;
  }
}

function isEmpty(obj: object): boolean {
  for (const _x in obj) {
    return false;
  }
  return true;
}

import { inboxPrefix } from "@cocalc/nats/names";
import getLogger from "@cocalc/backend/logger";
import { isValidUUID } from "@cocalc/util/misc";

const logger = getLogger("server:nats:auth:permissions");

export function getUserPermissions({
  project_id,
  account_id,
  project_ids,
}: CoCalcUser & { project_ids?: string[] }) {
  logger.debug("getUserPermissions", {
    account_id,
    project_id,
    project_ids,
  });
  if (project_id) {
    if (!isValidUUID(project_id)) {
      throw Error(`invalid project_id ${project_id}`);
    }
    return projectPermissions(project_id);
  } else if (account_id) {
    if (!isValidUUID(account_id)) {
      throw Error(`invalid account_id ${account_id}`);
    }
    const { pub, sub } = accountPermissions(account_id);
    if (project_ids) {
      for (const project_id of project_ids) {
        if (!isValidUUID(project_id)) {
          throw Error(`invalid project_id ${project_id}`);
        }
        const x = projectPermissions(project_id);
        pub.allow.push(...x.pub.allow);
        sub.allow.push(...x.sub.allow);
        pub.deny.push(...x.pub.deny);
        sub.deny.push(...x.sub.deny);
      }
    }
    return {
      pub: { allow: uniq(pub.allow), deny: uniq(pub.deny) },
      sub: { allow: uniq(sub.allow), deny: uniq(sub.deny) },
    };
  } else {
    throw Error("account_id or project_id must be specified");
  }
}

function uniq(v: string[]): string[] {
  return Array.from(new Set(v));
}

function commonPermissions(cocalcUser) {
  const pub = { allow: [] as string[], deny: [] as string[] };
  const sub = { allow: [] as string[], deny: [] as string[] };
  const userId = getCoCalcUserId(cocalcUser);
  if (!isValidUUID(userId)) {
    throw Error("must be a valid uuid");
  }
  const userType = getCoCalcUserType(cocalcUser);

  // can talk as *only this user* to the hub's api's
  pub.allow.push(`hub.${userType}.${userId}.>`);
  // everyone can publish to all inboxes.  This seems like a major
  //  security risk, but with request/reply, the reply subject under
  // _INBOX is a long random code that is only known for a moment
  // by the sender and the service, so I think it is NOT a security risk.
  pub.allow.push("_INBOX.>");

  // custom inbox only for this user -- critical for security, so we
  // can only listen to messages for us, and not for anybody else.
  sub.allow.push(inboxPrefix(cocalcUser) + ".>");
  // access to READ the public system info kv store.
  sub.allow.push("public.>");

  // get info about jetstreams
  pub.allow.push("$JS.API.INFO");
  // the public jetstream: this makes it available *read only* to all accounts and projects.
  pub.allow.push("$JS.API.*.*.public");
  pub.allow.push("$JS.API.*.*.public.>");
  pub.allow.push("$JS.API.CONSUMER.MSG.NEXT.public.>");

  // microservices info api -- **TODO: security concerns!?**
  // Please don't tell me I have to name all microservice identically :-(
  sub.allow.push("$SRV.>");
  pub.allow.push("$SRV.>");

  // so client can find out what they can pub/sub to...
  pub.allow.push("$SYS.REQ.USER.INFO");
  return { pub, sub };
}

function projectPermissions(project_id: string) {
  const { pub, sub } = commonPermissions({ project_id });

  pub.allow.push(`project.${project_id}.>`);
  sub.allow.push(`project.${project_id}.>`);

  pub.allow.push(`*.project-${project_id}.>`);
  sub.allow.push(`*.project-${project_id}.>`);

  // The unique project-wide jetstream key:value store
  pub.allow.push(`$JS.*.*.*.KV_project-${project_id}`);
  pub.allow.push(`$JS.*.*.*.KV_project-${project_id}.>`);
  // this FC is needed for "flow control" - without this, you get random hangs forever at scale!
  pub.allow.push(`$JS.FC.KV_project-${project_id}.>`);

  // The unique project-wide jetstream stream:
  pub.allow.push(`$JS.*.*.*.project-${project_id}`);
  pub.allow.push(`$JS.*.*.*.project-${project_id}.>`);
  pub.allow.push(`$JS.*.*.*.*.project-${project_id}.>`);
  return { pub, sub };
}

function accountPermissions(account_id: string) {
  const { pub, sub } = commonPermissions({ account_id });
  sub.allow.push(`*.account-${account_id}.>`);
  pub.allow.push(`*.account-${account_id}.>`);

  // the account-specific kv stores
  pub.allow.push(`$JS.*.*.*.KV_account-${account_id}`);
  pub.allow.push(`$JS.*.*.*.KV_account-${account_id}.>`);

  // the account-specific stream:
  pub.allow.push(`$JS.*.*.*.account-${account_id}`);
  pub.allow.push(`$JS.*.*.*.account-${account_id}.>`);
  pub.allow.push(`$JS.*.*.*.*.account-${account_id}`);
  pub.allow.push(`$JS.*.*.*.*.account-${account_id}.>`);
  sub.allow.push(`account.${account_id}.>`);
  pub.allow.push(`account.${account_id}.>`);

  // this FC is needed for "flow control" - without this, you get random hangs forever at scale!
  pub.allow.push(`$JS.FC.KV_account-${account_id}.>`);
  return { pub, sub };
}

// A CoCalc User is (so far): a project or account or a hub (not covered here).
type CoCalcUser =
  | {
      account_id: string;
      project_id?: string;
    }
  | {
      account_id?: string;
      project_id: string;
    };

function getCoCalcUserType({
  account_id,
  project_id,
}: CoCalcUser): "account" | "project" {
  if (account_id) {
    if (project_id) {
      throw Error("exactly one of account_id or project_id must be specified");
    }
    return "account";
  }
  if (project_id) {
    return "project";
  }
  throw Error("account_id or project_id must be specified");
}

function getCoCalcUserId({ account_id, project_id }: CoCalcUser): string {
  if (account_id) {
    if (project_id) {
      throw Error("exactly one of account_id or project_id must be specified");
    }
    return account_id;
  }
  if (project_id) {
    return project_id;
  }
  throw Error("account_id or project_id must be specified");
}

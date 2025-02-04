/*
This is meant to be similar to the nexts pages http api/v2, but using NATS instead of HTTPS.

To do development:

1. turn off nats-server handling for the hub by sending this message from a browser as an admin:

   await cc.client.nats_client.hub.system.terminate({service:'api'})

2. Run this script standalone:

    echo "require('@cocalc/server/nats').default()" | COCALC_MODE='single-user' DEBUG_CONSOLE=yes DEBUG=cocalc:* node

3. Optional: start more servers -- requests get randomly routed to exactly one of them:

    echo "require('@cocalc/server/nats').default()" | COCALC_MODE='single-user' DEBUG_CONSOLE=yes DEBUG=cocalc:* node
    echo "require('@cocalc/server/nats').default()" | COCALC_MODE='single-user' DEBUG_CONSOLE=yes DEBUG=cocalc:* node


To make use of this from a browser:

    await cc.client.nats_client.hub.system.getCustomize(['siteName'])

or

    await cc.client.nats_client.callHub({name:"system.getCustomize", args:[['siteName']]})

When you make changes, just restart the above.  All clients will instantly
use the new version after you restart, and there is no need to restart the hub
itself or any clients.

To view all requests (and replies) in realtime:

    nats sub api.v2 --match-replies
*/

import { JSONCodec } from "nats";
import getLogger from "@cocalc/backend/logger";
import { type HubApi, getUserId, transformArgs } from "@cocalc/nats/hub-api";
import { getConnection } from "@cocalc/backend/nats";
import userIsInGroup from "@cocalc/server/accounts/is-in-group";
import { terminate as terminateDatabase } from "@cocalc/database/nats/changefeeds";

const logger = getLogger("server:nats:api");

const jc = JSONCodec();

export async function initAPI() {
  const subject = "hub.*.*.api";
  logger.debug(`initAPI -- subject='${subject}', options=`, {
    queue: "0",
  });
  const nc = await getConnection();
  const sub = nc.subscribe(subject, { queue: "0" });
  for await (const mesg of sub) {
    const request = jc.decode(mesg.data) ?? ({} as any);
    if (request.name == "system.terminate") {
      // special hook so admin can terminate handling. This is useful for development.
      const { account_id } = getUserId(mesg.subject);
      if (!(!!account_id && (await userIsInGroup(account_id, "admin")))) {
        mesg.respond(jc.encode({ error: "only admin can terminate" }));
        continue;
      }
      // TODO: should be part of handleApiRequest below, but done differently because
      // one case halts this loop
      const { service } = request.args[0] ?? {};
      logger.debug(`Terminate service '${service}'`);
      if (service == "database") {
        terminateDatabase();
        mesg.respond(jc.encode({ status: "terminated", service }));
        continue;
      } else if (service == "api") {
        // special hook so admin can terminate handling. This is useful for development.
        console.warn("TERMINATING listening on ", subject);
        logger.debug("TERMINATING listening on ", subject);
        mesg.respond(jc.encode({ status: "terminated", service }));
        sub.unsubscribe();
        return;
      } else {
        mesg.respond(jc.encode({ error: `Unknown service ${service}` }));
      }
    } else {
      handleApiRequest(request, mesg);
    }
  }
}

async function handleApiRequest(request, mesg) {
  let resp;
  try {
    const { account_id, project_id } = getUserId(mesg.subject);
    const { name, args } = request as any;
    logger.debug("handling hub.api request:", {
      account_id,
      project_id,
      name,
    });
    resp = (await getResponse({ name, args, account_id, project_id })) ?? null;
  } catch (err) {
    resp = { error: `${err}` };
  }
  mesg.respond(jc.encode(resp));
}

import * as purchases from "./purchases";
import * as db from "./db";
import * as llm from "./llm";
import * as system from "./system";

export const hubApi: HubApi = {
  system,
  db,
  llm,
  purchases,
};

async function getResponse({ name, args, account_id, project_id }) {
  const [group, functionName] = name.split(".");
  const f = hubApi[group]?.[functionName];
  if (f == null) {
    throw Error(`unknown function '${name}'`);
  }
  const args2 = transformArgs({ name, args, account_id, project_id });
  return await f(...args2);
}

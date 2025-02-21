/*
Time sync entirely using nats itself.

To use this, call the default export, which is a sync
function that returns the current sync'd time (in ms since epoch), or
throws an error if the first time sync hasn't succeeded.
This gets initialized by default on load of your process.

It works using a key:value store via jetstream,
which is complicated overall.  Normal request/reply
messages don't seem to have a timestamp, so I couldn't
use them.

import getTime, {getSkew} from "@cocalc/nats/time";

// sync - this throws if hasn't connected and sync'd the first time:

getTime();  // -- ms since the epoch

// async -- will wait to connect and tries to sync if haven't done so yet.  Otherwise same as sync:
// once this works you can definitely call getTime henceforth.
await getSkew();

DEVELOPMENT:

See src/packages/backend/nats/test/time.test.ts for unit tests.


*/

import { dkv as createDkv } from "@cocalc/nats/sync/dkv";
import { getClient, getEnv } from "@cocalc/nats/client";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";
import { randomId } from "@cocalc/nats/names";
import { callback, delay } from "awaiting";
import { nanos } from "@cocalc/nats/util";

// max time to try when syncing
const TIMEOUT = 3 * 1000;

// sync clock this frequently once it has sync'd once
const INTERVAL_GOOD = 15 * 1000 * 60;
const INTERVAL_BAD = 15 * 1000;

export function init() {
  syncLoop();
}

let state = "running";
export function close() {
  state = "closed";
}

async function syncLoop() {
  while (state != "closed") {
    try {
      await getSkew();
      if (state == "closed") return;
      await delay(INTERVAL_GOOD);
    } catch (err) {
      console.log("WARNING: failed to sync clock ", err);
      if (state == "closed") return;
      await delay(INTERVAL_BAD);
    }
  }
}

let dkv: any = null;
const initDkv = reuseInFlight(async () => {
  const { account_id, project_id } = getClient();
  // console.log({ account_id, project_id, client: getClient() });
  dkv = await createDkv({
    account_id,
    project_id,
    env: await getEnv(),
    name: "time",
    limits: {
      max_age: nanos(4 * TIMEOUT),
    },
  });
});

// skew = amount in ms to subtract from our clock to get sync'd clock
export let skew: number | null = null;

export async function getSkew(): Promise<number> {
  if (dkv == null) {
    await initDkv();
  }
  const start = Date.now();
  const id = randomId();
  dkv.set(id, "");
  const f = (cb) => {
    const handle = ({ key }) => {
      const end = Date.now();
      if (key == id) {
        clearTimeout(timer);
        dkv.removeListener("change", handle);
        const serverTime = dkv.time(key)?.valueOf();
        dkv.delete(key);
        const rtt = end - start;
        skew = start + rtt / 2 - serverTime;
        cb(undefined, skew);
      }
    };
    dkv.on("change", handle);
    let timer = setTimeout(() => {
      dkv.removeListener("change", handle);
      dkv.delete(id);
      cb("timeout");
    }, TIMEOUT);
  };
  return await callback(f);
}

export default function getTime(): number {
  if (skew == null) {
    throw Error("clock skew not known");
  }
  return Date.now() - skew;
}

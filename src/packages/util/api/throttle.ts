/*
Generic throttling protocol for rate limiting api requests.

It limits the number of requests per second, minute and hour using a TTL
data structure and keeping track of all access of times during the interval.
*/

import TTLCache from "@isaacs/ttlcache";
import { plural } from "@cocalc/util/misc";

/*
We specify non-default throttling parameters for an endpoint *here* rather than in @cocalc/server,
so that we can enforce them in various places.  E.g., by specifying them here,
we can enforce them both on the frontend and the backend with different semantics,
so the backend enforcement is only needed if the frontend client is somehow abusive
(i.e., not our client but one written by somebody else).

CAREFUL: if you make a change it won't be reflected in all clients since they use
this hardcoded value, rather than an api endoint to get this.
*/

const THROTTLE = {
  "purchases/stripe/get-payments": {
    second: 1,
    minute: 5,
    hour: 100,
  },
} as const;

const DEFAULTS = {
  second: 1,
  minute: 15,
  hour: 200,
} as const;

type Interval = keyof typeof DEFAULTS;

const INTERVALS: Interval[] = ["second", "minute", "hour"] as const;

const cache = {
  second: new TTLCache<string, number[]>({
    max: 100000,
    ttl: 1000,
    updateAgeOnGet: true,
  }),
  minute: new TTLCache<string, number[]>({
    max: 100000,
    ttl: 1000 * 60,
    updateAgeOnGet: true,
  }),
  hour: new TTLCache<string, number[]>({
    max: 100000,
    ttl: 1000 * 1000 * 60,
    updateAgeOnGet: true,
  }),
};

export default function throttle({
  endpoint,
  account_id,
}: {
  endpoint: string;
  // if not given, viewed as global
  account_id?: string;
}) {
  if (process["env"]?.["JEST_WORKER_ID"]) {
    // do not throttle when testing.
    return;
  }
  const key = `${account_id ? account_id : ""}:${endpoint}`;
  const m = maxPerInterval(endpoint);
  const now = Date.now();
  for (const interval of INTERVALS) {
    const c = cache[interval];
    if (c == null) continue; // can't happen
    const v = c.get(key);
    if (v == null) {
      c.set(key, [now]);
      continue;
    }
    // process mutates v in place, so efficient
    process(v, now, interval, m[interval], endpoint);
  }
}

const TO_MS = {
  second: 1000,
  minute: 1000 * 60,
  hour: 1000 * 60 * 60,
} as const;

function process(
  v: number[],
  now: number,
  interval: Interval,
  maxPerInterval: number,
  endpoint: string,
) {
  const cutoff = now - TO_MS[interval];
  // mutate v so all numbers in it are >= cutoff:
  for (let i = 0; i < v.length; i++) {
    if (v[i] < cutoff) {
      v.splice(i, 1);
      i--; // Adjust index due to array mutation
    }
  }
  if (v.length >= maxPerInterval) {
    const wait = Math.ceil((v[0] - cutoff) / 1000);
    throw Error(
      `too many requests to ${endpoint}; try again in ${wait} ${plural(wait, "second")} (rule: at most ${maxPerInterval} ${plural(maxPerInterval, "request")} per ${interval})`,
    );
  }
  v.push(now);
}

function maxPerInterval(endpoint): {
  second: number;
  minute: number;
  hour: number;
} {
  const a = THROTTLE[endpoint];
  if (a == null) {
    return DEFAULTS;
  }
  return {
    second: a["second"] ?? DEFAULTS.second,
    minute: a["minute"] ?? DEFAULTS.minute,
    hour: a["hour"] ?? DEFAULTS.hour,
  };
}

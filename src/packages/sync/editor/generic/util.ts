/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { CompressedPatch, Patch } from "./types";
import { diff_match_patch } from "@cocalc/util/dmp";

const dmp = new diff_match_patch();
dmp.Diff_Timeout = 0.2; // computing a diff won't block longer than about 0.2s

// Here's what a diff-match-patch patch looks like
//
// [{"diffs":[[1,"{\"x\":5,\"y\":3}"]],"start1":0,"start2":0,"length1":0,"length2":13},...]
//

// TODO: we must explicitly type these as "Function" or typescript gives errors.
// We should of course explicitly type the inputs and outputs of each, which
// will make other code more robust. See above and look at the source...
export const diff_main: Function = dmp.diff_main.bind(dmp);
export const patch_make: Function = dmp.patch_make.bind(dmp);

// The diff-match-patch library changed the format, but we must keep it the same
// for backward compat and two stay JSON friendly.

const Diff = diff_match_patch.Diff;

function diffs_to_arrays(diffs: any[]): any[] {
  const v: any[] = [];
  for (const d of diffs) {
    v.push([d[0], d[1]]);
  }
  return v;
}

function arrays_to_diffs(arrays: any[]): any[] {
  const v: any[] = [];
  for (const x of arrays) {
    v.push(new Diff(x[0], x[1]));
  }
  return v;
}

export function compress_patch(patch: CompressedPatch): CompressedPatch {
  return patch.map((p) => [
    diffs_to_arrays(p.diffs),
    p.start1,
    p.start2,
    p.length1,
    p.length2,
  ]);
}

export function decompress_patch(patch: CompressedPatch): CompressedPatch {
  return patch.map((p) => ({
    diffs: arrays_to_diffs(p[0]),
    start1: p[1],
    start2: p[2],
    length1: p[3],
    length2: p[4],
  }));
}

// return *a* compressed patch that transforms string s0 into string s1.
export function make_patch(s0: string, s1: string): CompressedPatch {
  // @ts-ignore
  return compress_patch(dmp.patch_make(s0, s1));
}

// apply a compressed patch to a string.
export function apply_patch(
  patch: CompressedPatch,
  s: string,
): [string, boolean] {
  let x;
  try {
    x = dmp.patch_apply(decompress_patch(patch), s);
    //console.log('patch_apply ', misc.to_json(decompress_patch(patch)), x)
  } catch (err) {
    // If a patch is so corrupted it can't be parsed -- e.g., due to a bug in SMC -- we at least
    // want to make application the identity map (i.e., "best effort"), so
    // the document isn't completely unreadable!
    console.warn(`apply_patch -- ${err}, ${JSON.stringify(patch)}`);
    return [s, false];
  }
  let clean = true;
  for (const a of x[1]) {
    if (!a) {
      clean = false;
      break;
    }
  }
  return [x[0], clean];
}

import { cmp_array } from "@cocalc/util/misc";

export function patch_cmp(a: Patch, b: Patch): number {
  return cmp_array(
    [a.time, a.version, a.user_id],
    [b.time, b.version, b.user_id],
  );
}

export function time_cmp(a: Date, b: Date): number {
  const t = a.valueOf() - b.valueOf();
  if (t < 0) {
    return -1;
  } else if (t > 0) {
    return 1;
  } else {
    return 0;
  }
}

// Do a 3-way **string** merge by computing patch that transforms
// base to remote, then applying that patch to local.
export function three_way_merge(opts: {
  base: string;
  local: string;
  remote: string;
}): string {
  if (opts.base === opts.remote) {
    // trivial special case...
    return opts.local;
  }
  // @ts-ignore
  return dmp.patch_apply(dmp.patch_make(opts.base, opts.remote), opts.local)[0];
}

export function isTestClient(client: any) {
  return !!client?.isTestClient?.();
}

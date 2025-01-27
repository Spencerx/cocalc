/*
Sync embeddings with vector database.

There are two steps:

1. Initialization:
  - Remote: Query to get the id's and hashes of all embeddings associated
    to this document that are currently stored in the vector database
  - Local: Compute the id's, payloads, and hashes for this document.

2. Sync: We remove/save data so that what is stored in the vector database
matches the current state of the document here.  This is done periodically
as the document changes.  If multiple editors are editing the document they
might both do this right now, but that doesn't cause any harm since its
idempotent.  We do this as follows:
  - Update local view of things
  - Do remove and save operations
  - Update our view of what remote knows.

It's conceivable that somehow remote ends up slightly out of sync with what
we think.  That will be fixed next time the full init step runs.  Also,
slightly temporary issues of too much or too little data in the search index
are not "fatal data loss" for us, since this is just search.
*/

import jsonStable from "json-stable-stringify";
import { debounce } from "lodash";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { SyncDB } from "@cocalc/sync/editor/db";
import type { Document } from "@cocalc/sync/editor/generic/types";
import { EmbeddingData } from "@cocalc/util/db-schema/llm";
import { close, copy_with, len, sha1, uuidsha1 } from "@cocalc/util/misc";

// How long until we update the index, if users stops using this file actively.
const DEBOUNCE_MS = 7500;

// For now, only index something if it has at least 6 characters.
const MIN_LENGTH = 6;

const log = (..._args) => {};
// const log = console.log;

interface Options {
  project_id: string;
  path: string;
  syncdb: SyncDB;
  primaryKey: string;
  textColumn: string;
  metaColumns?: string[];
  transform?: (elt: object) => undefined | object;
  debounceMs?: number;
}

export default function embeddings(opts: Options): Embeddings {
  return new Embeddings(opts);
}

class Embeddings {
  private syncdb: SyncDB;
  private syncDoc?: Document;
  private project_id: string;
  private path: string;
  private primaryKey: string; // primary key of the syncdb; so at least this fragment should work:  "id={obj[primary]}"
  private textColumn: string; // the name of the column that has the text that gets indexed
  private metaColumns?: string[]; // the names of the metadata columns
  private transform?: (elt: object) => undefined | object;
  private waitUntil?: number; // if given, don't try to sync again until this point in time (ms since epoch).

  // map from point_id to hash and fragment_id for each remote element
  private remote: { [point_id: string]: EmbeddingData } = {};

  // map from point_id to Data {id,text,meta,hash} for
  // each local task
  private local: { [point_id: string]: EmbeddingData } = {};

  private initialized: boolean = false;
  private syncing: boolean = false;

  private url: string;

  constructor({
    project_id,
    path,
    syncdb,
    primaryKey,
    textColumn,
    metaColumns,
    transform,
    debounceMs = DEBOUNCE_MS,
  }: Options) {
    this.syncdb = syncdb;
    this.project_id = project_id;
    this.path = path;
    this.primaryKey = primaryKey;
    this.textColumn = textColumn;
    this.metaColumns = metaColumns;
    this.transform = transform;
    this.url = `projects/${project_id}/files/${path}`;
    if (!this.isEnabled()) {
      // if disabled we just never do anything.
      return;
    }
    syncdb.once("change", () => this.init());
    syncdb.on(
      "change",
      debounce(async () => {
        if (this.waitUntil != null && Date.now() < this.waitUntil) {
          return;
        }
        try {
          await this.sync();
        } catch (err) {
          console.warn(
            `WARNING: issue syncing embeddings for "${this.path}:"`,
            err,
          );
          this.waitUntil = Date.now() + 60 * 1000; // wait a bit before trying again.
        }
      }, debounceMs),
    );
    syncdb.once("closed", () => {
      close(this);
    });
    // window.x = this;
  }

  pointId(fragmentId: string): string {
    return uuidsha1(`\\${this.url}#${fragmentId}`);
  }

  isEnabled(): boolean {
    return webapp_client.openai_client.neuralSearchIsEnabled();
  }

  private async init() {
    try {
      await this.initLocal();
      await this.initRemote();
      this.initialized = true;
      await this.sync();
    } catch (err) {
      console.warn(
        `WARNING: issue initializing embeddings for ${this.url}: ${err}`,
      );
    }
  }

  private async initRemote() {
    const query = {
      scope: `${this.url}#`, // hash so don't get data for files that start with the same filename
      selector: { include: ["hash", "url"] },
      // NOTE: If somehow the limit isn't high enough, that only means that we would
      // send some data to the backend that is already there during the first sync;
      // it's only an efficiency issue.
      limit: this.local != null ? Math.round(1.2 * len(this.local) + 50) : 1000,
    };
    const remote = await webapp_client.openai_client.embeddings_search(query);
    // empty current this.remote:
    Object.keys(this.remote).forEach((key) => delete this.remote[key]);
    for (const { id, payload } of remote) {
      const { hash, url } = payload as { hash: string; url: string };
      this.remote[id] = { hash, id: url.split("#")[1] };
    }
  }

  private toData(elt) {
    const text = elt[this.textColumn]?.trim() ?? "";
    let meta, hash;
    if (this.metaColumns != null && this.metaColumns.length > 0) {
      meta = copy_with(elt, this.metaColumns);
      hash = text ? sha1(jsonStable({ ...meta, text })) : undefined;
    } else {
      meta = undefined;
      hash = text ? sha1(text) : undefined;
    }
    const id = `id=${elt[this.primaryKey]}`;
    return { text, meta, hash, id };
  }

  private async initLocal() {
    Object.keys(this.local).forEach((key) => delete this.local[key]);
    this.syncDoc = this.syncdb.get_doc(); // save doc so we can tell what changed later
    this.syncdb
      .get()
      .toJS()
      .map((elt) => {
        if (this.transform) {
          elt = this.transform(elt);
          if (elt == null) return;
        }
        const data = this.toData(elt);
        if (data.text) {
          this.local[this.pointId(data.id)] = data;
        }
      });
  }

  private isNontrivial(text?: string): boolean {
    return (text?.trim().length ?? 0) >= MIN_LENGTH;
  }

  private async updateLocal() {
    if (this.syncDoc == null) {
      await this.initLocal();
      return;
    }
    // this patch encodes what changed since we last updated local:
    const patch = this.syncDoc.make_patch(this.syncdb.get_doc());
    for (let i = 0; i < patch.length; i += 2) {
      const operation = patch[i];
      const tasks = patch[i + 1];
      for (const task of tasks) {
        const id = task[this.primaryKey];
        const point_id = this.pointId(`id=${id}`);
        if (operation == -1) {
          delete this.local[point_id];
        } else if (operation == 1) {
          let elt = this.syncdb.get_one({ [this.primaryKey]: id })?.toJS();
          if (elt != null) {
            if (this.transform) {
              elt = this.transform(elt);
              if (elt == null) continue;
            }
            const data = this.toData(elt);
            if (this.isNontrivial(data.text)) {
              this.local[point_id] = data;
            } else {
              delete this.local[point_id];
            }
          }
        }
      }
    }
  }

  private async sync() {
    if (this.syncing) return;
    try {
      this.syncing = true;
      if (!this.initialized) return;
      await this.updateLocal();
      if (!this.initialized) return;
      await this.syncDeleteRemote();
      if (!this.initialized) return;
      await this.syncSaveLocal();
    } finally {
      this.syncing = false;
    }
  }

  // delete all remote ones that aren't here locally.
  private async syncDeleteRemote() {
    const data: EmbeddingData[] = [];
    for (const point_id in this.remote) {
      if (this.local[point_id] == null) {
        data.push(this.remote[point_id]);
      }
    }
    if (data.length == 0) return;
    const ids = await webapp_client.openai_client.embeddings_remove({
      project_id: this.project_id,
      path: this.path,
      data,
    });
    if (this.remote == null) {
      // nothing to do -- probably closed during the above async call.
      return;
    }
    // keep our view of remote in sync.
    for (const id of ids) {
      delete this.remote[id];
    }
    log("embeddings -- deleted", ids);
  }

  // save all local data that isn't already saved
  private async syncSaveLocal() {
    const data: EmbeddingData[] = [];
    for (const id in this.local) {
      const remote = this.remote[id];
      if (remote == null || remote.hash != this.local[id].hash) {
        if (this.local[id].text) {
          //  save it
          data.push(this.local[id]);
        }
      }
    }
    const ids = await webapp_client.openai_client.embeddings_save({
      project_id: this.project_id,
      path: this.path,
      data,
    });
    if (this.remote == null || this.local == null) {
      // nothing to do -- probably closed during the above async call.
      return;
    }
    log("embeddings -- saved", ids);
    for (const id of ids) {
      this.remote[id] = this.local[id];
    }
  }
}

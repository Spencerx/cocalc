/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Jupyter's blob store (based on sqlite), which hooks into the raw http server.
*/

import Database from "better-sqlite3";
import * as fs from "node:fs";

import Logger from "@cocalc/backend/logger";
import { sha1 as misc_node_sha1 } from "@cocalc/backend/misc_node";
import type { BlobStoreInterface } from "@cocalc/jupyter/types/project-interface";
import { months_ago } from "@cocalc/util/misc";
import { readFile } from "fs/promises";
import { BASE64_TYPES } from "./get";

const winston = Logger("jupyter-blobs:sqlite");

const JUPYTER_BLOBS_DB_FILE: string =
  process.env.JUPYTER_BLOBS_DB_FILE ??
  `${process.env.SMC_LOCAL_HUB_HOME ?? process.env.HOME}/.jupyter-blobs-v0.db`;

export class BlobStoreSqlite implements BlobStoreInterface {
  private db: Database.Database;
  private stmt_insert;
  private stmt_update;
  private stmt_get;
  private stmt_data;
  private stmt_ipynb;
  private stmt_keys;

  constructor() {
    winston.debug("jupyter BlobStore: constructor");
    try {
      this.init();
      winston.debug(`jupyter BlobStore: ${JUPYTER_BLOBS_DB_FILE} opened fine`);
    } catch (err) {
      winston.debug(
        `jupyter BlobStore: ${JUPYTER_BLOBS_DB_FILE} open error - ${err}`,
      );
      // File may be corrupt/broken/etc. -- in this case, remove and try again.
      // This database is only an image *cache*, so this is fine.
      // See https://github.com/sagemathinc/cocalc/issues/2766
      // Using sync is also fine, since this only happens once
      // during initialization.
      winston.debug("jupyter BlobStore: resetting database cache");
      try {
        fs.unlinkSync(JUPYTER_BLOBS_DB_FILE);
      } catch (error) {
        err = error;
        winston.debug(
          `Error trying to delete ${JUPYTER_BLOBS_DB_FILE}... ignoring: `,
          err,
        );
      }
      this.init();
    }
  }

  init(): void {
    if (JUPYTER_BLOBS_DB_FILE == "memory") {
      // as any, because @types/better-sqlite3 is not yet updated to support this
      // doc about the constructor: https://wchargin.com/better-sqlite3/api.html#new-databasepath-options
      this.db = new Database(".db", { memory: true } as any);
    } else {
      this.db = new Database(JUPYTER_BLOBS_DB_FILE);
    }

    this.init_table();
    this.init_statements(); // table must exist!

    if (JUPYTER_BLOBS_DB_FILE !== "memory") {
      this.clean(); // do this once on start
      this.db.exec("VACUUM");
    }
  }

  private init_table() {
    this.db
      .prepare(
        "CREATE TABLE IF NOT EXISTS blobs (sha1 TEXT, data BLOB, type TEXT, ipynb TEXT, time INTEGER)",
      )
      .run();
  }

  private init_statements() {
    this.stmt_insert = this.db.prepare(
      "INSERT INTO blobs VALUES(?, ?, ?, ?, ?)",
    );
    this.stmt_update = this.db.prepare("UPDATE blobs SET time=? WHERE sha1=?");
    this.stmt_get = this.db.prepare("SELECT * FROM blobs WHERE sha1=?");
    this.stmt_data = this.db.prepare("SELECT data FROM blobs where sha1=?");
    this.stmt_keys = this.db.prepare("SELECT sha1 FROM blobs");
    this.stmt_ipynb = this.db.prepare(
      "SELECT ipynb, type, data FROM blobs where sha1=?",
    );
  }

  private clean(): void {
    this.clean_old();
    this.clean_filesize();
  }

  private clean_old() {
    // Delete anything old...
    // The main point of this blob store being in the db is to ensure that when the
    // project restarts, then user saves an ipynb,
    // that they do not loose any work.  So a few weeks should be way more than enough.
    // Note that TimeTravel may rely on these old blobs, so images in TimeTravel may
    // stop working after this long.  That's a tradeoff.
    this.db
      .prepare("DELETE FROM blobs WHERE time <= ?")
      .run(months_ago(1).getTime());
  }

  private clean_filesize() {
    // we also check for the actual filesize and in case, get rid of half of the old blobs
    try {
      const stats = fs.statSync(JUPYTER_BLOBS_DB_FILE);
      const size_mb = stats.size / (1024 * 1024);
      if (size_mb > 128) {
        const cnt = this.db
          .prepare("SELECT COUNT(*) as cnt FROM blobs")
          .get() as { cnt: number } | undefined;
        if (cnt?.cnt == null) return;
        const n = Math.floor(cnt.cnt / 2);
        winston.debug(
          `jupyter BlobStore: large file of ${size_mb}MiB detected – deleting ${n} old rows.`,
        );
        if (n == 0) return;
        const when = this.db
          .prepare("SELECT time FROM blobs ORDER BY time ASC LIMIT 1 OFFSET ?")
          .get(n) as { time?: number } | undefined;
        if (when?.time == null) return;
        winston.debug(`jupyter BlobStore: delete starting from ${when.time}`);
        this.db.prepare("DELETE FROM blobs WHERE time <= ?").run(when.time);
      }
    } catch (err) {
      winston.debug(`jupyter BlobStore: clean_filesize error: ${err}`);
    }
  }

  // used in testing
  async delete_all_blobs(): Promise<void> {
    this.db.prepare("DELETE FROM blobs").run();
  }

  // data could, e.g., be a uuencoded image
  // We return the sha1 hash of it, and store it, along with a reference count.
  // ipynb = (optional) text that is also stored and will be
  //         returned when get_ipynb is called
  //         This is used for some iframe support code.
  save(data: string, type: string, ipynb?: string): string {
    const buf: Buffer = BASE64_TYPES.includes(type as any)
      ? Buffer.from(data, "base64")
      : Buffer.from(data);

    const sha1: string = misc_node_sha1(buf);
    const row = this.stmt_get.get(sha1);
    if (row == null) {
      this.stmt_insert.run([sha1, buf, type, ipynb, Date.now()]);
    } else {
      this.stmt_update.run([Date.now(), sha1]);
    }
    return sha1;
  }

  // Read a file from disk and save it in the database.
  // Returns the sha1 hash of the file.
  async readFile(path: string, type: string): Promise<string> {
    const content = await readFile(path);
    if (typeof content === "string") {
      return await this.save(content, type);
    } else {
      // This case never happens, because readFile without encoding returns a string.
      // We include it to make TypeScript happy.
      return await this.save(content.toString(), type);
    }
  }

  /*
  free(sha1: string): void {
    // instead, stuff gets freed 1 month after last save.
  }
  */

  // Return data with given sha1, or undefined if no such data.
  get(sha1: string): undefined | Buffer {
    const x = this.stmt_data.get(sha1);
    if (x != null) {
      return x.data;
    }
  }

  get_ipynb(sha1: string): string | undefined {
    const row = this.stmt_ipynb.get(sha1);
    if (row == null) {
      return;
    }
    if (row.ipynb != null) {
      return row.ipynb;
    }
    if (BASE64_TYPES.includes(row.type)) {
      return row.data.toString("base64");
    } else {
      return row.data.toString();
    }
  }

  async keys(): Promise<string[]> {
    return this.stmt_keys.all().map((x) => x.sha1);
  }
}

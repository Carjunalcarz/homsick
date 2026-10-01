import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "./client";
import { runMigrations } from "./migrate";

export type TestDb = {
  db: Db;
  filePath: string;
  /** Close the connection and delete the temp files. */
  cleanup: () => void;
};

/**
 * Tests only: a fresh temp-file SQLite with every migration applied, opened
 * with the same pragmas as the app. Use one per test file.
 */
export function createTestDb(): TestDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opd-test-"));
  const filePath = path.join(dir, "test.sqlite");
  const db = openDatabase(filePath);
  runMigrations(db);
  return {
    db,
    filePath,
    cleanup: () => {
      if (db.$client.open) db.$client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

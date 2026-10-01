import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./client";
import { runMigrations } from "./migrate";

/** File name prefixes in BACKUP_DIR (Operations). */
export const NIGHTLY_PREFIX = "opd-";
export const PRE_MIGRATE_PREFIX = "pre-migrate-";
export const NIGHTLY_KEEP = 30;
export const PRE_MIGRATE_KEEP = 10;

/**
 * A backup temp file older than this was left by a copy that crashed (a copy
 * takes seconds), so the next backup with the same prefix removes it.
 */
export const STALE_TEMP_MS = 60 * 60 * 1000;

export type BackupResult = { file: string; bytes: number };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Delete the temp files `<prefix>….tmp` in `dir` older than STALE_TEMP_MS
 * (left by a crash during `VACUUM INTO`). Fresh temp files, which may belong
 * to a copy in progress, and every other file are left alone. Returns the
 * deleted names.
 */
export function removeStaleTemps(dir: string, prefix: string, now: Date = new Date()): string[] {
  if (!fs.existsSync(dir)) return [];
  const pattern = new RegExp(`^${escapeRegExp(prefix)}.*\\.tmp$`);
  const removed: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (now.getTime() - fs.statSync(file).mtimeMs <= STALE_TEMP_MS) continue;
    fs.rmSync(file, { force: true });
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Copy the database to `file` with `VACUUM INTO` (a consistent snapshot, WAL
 * included). The copy goes to a temp file next to it and is renamed only when
 * complete, so a partial file never looks like a backup; on failure the temp
 * file is removed. An existing `file` is replaced. First removes stale temp
 * files with the same `prefix` (default: the file's name). Synchronous: VACUUM
 * can't run inside a transaction, so never call it from one.
 */
export function backupTo(db: Db, file: string, prefix?: string, now: Date = new Date()): BackupResult {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  removeStaleTemps(path.dirname(target), prefix ?? path.basename(target), now);
  // Ends in .tmp, so pruneBackups() never mistakes it for a backup.
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    db.$client.prepare("VACUUM INTO ?").run(temp);
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return { file: target, bytes: fs.statSync(target).size };
}

/**
 * The backups `prefix` names in `dir`: `<prefix><date or timestamp>.sqlite`,
 * where the part after the prefix starts with a digit and holds only digits,
 * `-`, `T` and `Z`. Anything else in the folder is never matched.
 */
export function listBackups(dir: string, prefix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\d[\\dTZ-]*\\.sqlite$`);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Keep the newest `keep` backups named `<prefix>…sqlite` in `dir` and delete
 * the older ones. Names sort by their date or UTC timestamp. `protect` (the
 * file just written) is always kept and counts toward `keep`, even when a
 * clock that is behind gives it an older name. Returns the deleted names.
 */
export function pruneBackups(dir: string, prefix: string, keep: number, protect?: string): string[] {
  const all = listBackups(dir, prefix);
  const protectedHere = protect !== undefined && all.includes(protect);
  const others = all.filter((name) => name !== protect);
  const keepOthers = Math.max(0, protectedHere ? keep - 1 : keep);
  const old = others.slice(0, Math.max(0, others.length - keepOthers));
  for (const name of old) fs.rmSync(path.join(dir, name), { force: true });
  return old;
}

/** `2026-09-27T01:02:03.456Z` → `20260927T010203Z`. */
export function backupTimestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** Whether the database holds any table yet (a new or empty file doesn't). */
function hasTables(db: Db): boolean {
  const row = db.$client.prepare("select count(*) as n from sqlite_master where type = 'table'").get() as { n: number };
  return row.n > 0;
}

/**
 * Before `db:migrate`: copy an existing database to
 * `BACKUP_DIR/pre-migrate-<UTC timestamp>.sqlite` and keep the newest
 * PRE_MIGRATE_KEEP of them (never the one just written). A new or empty
 * database is skipped (null). Throws when the copy fails.
 */
export function backupBeforeMigrate(db: Db, backupDir: string, now: Date = new Date()): BackupResult | null {
  if (!hasTables(db)) return null;
  const name = `${PRE_MIGRATE_PREFIX}${backupTimestamp(now)}.sqlite`;
  // Temp file ages are compared with the real clock (file times are real).
  const result = backupTo(db, path.join(backupDir, name), PRE_MIGRATE_PREFIX);
  pruneBackups(backupDir, PRE_MIGRATE_PREFIX, PRE_MIGRATE_KEEP, name);
  return result;
}

/**
 * `db:migrate`: the pre-migration backup, then the migrations. When the
 * backup fails, this throws and nothing is migrated. Returns the backup
 * (null for a new or empty database).
 */
export function migrateWithBackup(
  db: Db,
  backupDir: string,
  now: Date = new Date(),
  migrationsFolder?: string,
): BackupResult | null {
  let backup: BackupResult | null;
  try {
    backup = backupBeforeMigrate(db, backupDir, now);
  } catch (error) {
    throw new Error(
      `Pre-migration backup to ${path.resolve(backupDir)} failed, so nothing was migrated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  runMigrations(db, migrationsFolder);
  return backup;
}

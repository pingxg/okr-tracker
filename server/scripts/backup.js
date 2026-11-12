/**
 * Database backup (replaces the Firestore backup/restore Cloud Functions).
 *
 *   node scripts/backup.js              writes backups/okr-<timestamp>.dump
 *   BACKUP_DIR=/data node scripts/backup.js
 *
 * Uses `pg_dump --format=custom`; restore with
 *   pg_restore --clean --if-exists -d "$DATABASE_URL" okr-<timestamp>.dump
 *
 * On Render the managed database already has point-in-time recovery; run this
 * as a weekly Cron Job and copy the file to external storage (spec §13).
 * Keeps the newest BACKUP_KEEP files (default 14).
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import config from '../src/config.js';

const dir = process.env.BACKUP_DIR || path.resolve('backups');
const keep = Number(process.env.BACKUP_KEEP || 14);

await mkdir(dir, { recursive: true });
const file = path.join(dir, `okr-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);

await new Promise((resolve, reject) => {
  const child = spawn(
    'pg_dump',
    ['--format=custom', '--no-owner', `--file=${file}`, config.databaseUrl],
    {
      stdio: 'inherit',
    }
  );
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}`))
  );
});
console.log(`Backup written to ${file}`);

const dumps = (await readdir(dir)).filter((f) => /^okr-.*\.dump$/.test(f)).sort();
for (const old of dumps.slice(0, Math.max(0, dumps.length - keep))) {
  await rm(path.join(dir, old));
  console.log(`Removed old backup ${old}`);
}

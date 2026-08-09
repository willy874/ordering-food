import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

/**
 * Migration 一律走原始的 pg client，不經過 Drizzle。
 *
 * 這裡跑的是任意 DDL，包含 Drizzle schema 還不知道（或刻意不描述）的東西，
 * 例如 _migrations 這張表、plpgsql 函式與觸發器。結構的來源是這些 .sql 檔，
 * server/schema.js 只是套用完之後的描述——順序反過來會很難收拾。
 */
const dir = path.dirname(fileURLToPath(import.meta.url));

await pool.query(`
  create table if not exists _migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  )`);

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const { rows } = await pool.query('select name from _migrations');
const applied = new Set(rows.map((r) => r.name));

let count = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`· 已套用過 ${file}`);
    continue;
  }
  const sql = await readFile(path.join(dir, file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('insert into _migrations (name) values ($1)', [file]);
    await client.query('COMMIT');
    console.log(`✓ 套用 ${file}`);
    count += 1;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✗ ${file} 失敗：${err.message}`);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }
}

console.log(count ? `\n完成，共套用 ${count} 個 migration。` : '\n沒有新的 migration。');
await pool.end();

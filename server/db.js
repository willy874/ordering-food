import net from 'node:net';
import dns from 'node:dns';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('[db] 缺少 DATABASE_URL 環境變數，請參考 .env.example');
  process.exit(1);
}

// Neon 的 endpoint 同時有 A 與 AAAA 記錄。Node 20 起預設啟用的 autoSelectFamily
// （Happy Eyeballs）在沒有可用 IPv6 路由的網路上會嘗試 IPv6 後卡住而不 fallback，
// 導致連線 ETIMEDOUT。關閉它並優先使用 IPv4，讓連線走已驗證可達的路徑。
net.setDefaultAutoSelectFamily(false);
dns.setDefaultResultOrder('ipv4first');

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

// Vercel 上每個函式實例都是獨立程序，可能同時存在數十個。
// 每個實例各開一池會很快耗盡 Postgres 連線數，因此限制為 1，
// 真正的併發交給 Neon 的 pooler（連線字串中的 -pooler）處理。
const isServerless = Boolean(process.env.VERCEL);

/**
 * 連線池仍由 pg 管理，Drizzle 只包在上面當查詢層。
 * migrations/run.js 需要直接跑多語句的 .sql 檔，因此這裡照樣把 pool 導出。
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon 憑證可通過完整驗證，不需放寬 rejectUnauthorized
  ssl: isLocal ? false : true,
  max: isServerless ? 1 : 5,
  idleTimeoutMillis: isServerless ? 5_000 : 10_000,
});

pool.on('error', (err) => {
  console.error('[db] 連線池錯誤', err);
});

/**
 * 全域查詢入口。
 *
 * 帶上 schema 才有 db.query.<table>.findMany 這組關聯式查詢，
 * 團的訂單連同品項與分單名單就靠它一次讀出來（見 routes/groups.js 的 loadOrders）。
 */
export const db = drizzle(pool, { schema });

/**
 * 在單一 transaction 中執行，失敗自動 rollback。
 *
 * 回呼收到的 tx 與 db 介面相同，因此所有 helper 都寫成「吃一個 executor」，
 * 交易內外共用同一份程式碼。
 */
export const withTransaction = (fn) => db.transaction(fn);

export const closeDb = () => pool.end();

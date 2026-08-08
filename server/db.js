import net from 'node:net';
import dns from 'node:dns';
import pg from 'pg';

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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon 憑證可通過完整驗證，不需放寬 rejectUnauthorized
  ssl: isLocal ? false : true,
  max: 5,
  idleTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] 連線池錯誤', err);
});

export const query = (text, params) => pool.query(text, params);

/** 在單一 transaction 中執行，失敗自動 rollback */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

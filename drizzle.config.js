import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 設定。
 *
 * 這裡刻意只用來「對照」，不用來套用變更：正式資料庫的結構由
 * server/migrations/*.sql 與 server/migrations/run.js 負責（npm run migrate），
 * server/schema.js 是套用完之後的描述。
 *
 * 有用的指令：
 *   npx drizzle-kit pull    把線上結構抓成 SQL 與 schema，用來比對 server/schema.js
 *
 * 不要跑 push／generate／migrate。資料庫裡已經有幾支 migration 刻意留下的
 * 過渡欄位（orders.status、orders.is_manager）與 _migrations 這張表，
 * 那些不在 server/schema.js 裡，自動產生的差異會把它們一起刪掉。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/schema.js',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

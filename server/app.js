import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './lib/errors.js';
import storesRouter from './routes/stores.js';
import groupsRouter from './routes/groups.js';
import ordersRouter from './routes/orders.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(dirname, '../client/dist');

/**
 * 建立 Express app，但不負責監聽。
 *
 * serveStatic 用來區分兩種執行環境：
 *   本機／一般 Node 主機 — 由 Express 同時提供 API 與前端靜態檔
 *   Vercel               — 靜態檔由 CDN 直接送出，函式只處理 /api/*
 */
export function createApp({ serveStatic = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', storesRouter);
  app.use('/api', groupsRouter);
  app.use('/api', ordersRouter);

  // 未匹配的 API 路徑要回 404，不能落到下面的 SPA fallback
  app.use('/api', (req, res) => {
    res.status(404).json({ error: '找不到這個 API' });
  });

  if (serveStatic) {
    app.use(express.static(clientDist));
    // SPA fallback：任何 GET 都交還 index.html 由前端路由處理
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDist, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  }

  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    // Drizzle 把驅動層的錯誤包成 DrizzleQueryError，訊息裡帶著完整 SQL 與參數，
    // 而參數可能含 editToken／adminToken。只記錄原始的資料庫錯誤與 SQL 本身。
    if (err?.query && err.cause) {
      console.error('[error]', err.cause, '\n  query:', err.query);
    } else {
      console.error('[error]', err);
    }
    res.status(500).json({ error: '伺服器發生錯誤' });
  });

  return app;
}

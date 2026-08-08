import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './lib/errors.js';
import storesRouter from './routes/stores.js';
import groupsRouter from './routes/groups.js';
import ordersRouter from './routes/orders.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(dirname, '../client/dist');

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

app.use(express.static(clientDist));

// SPA fallback：任何 GET 都交還 index.html 由前端路由處理
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next(err);
  });
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[error]', err);
  res.status(500).json({ error: '伺服器發生錯誤' });
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${port}`);
});

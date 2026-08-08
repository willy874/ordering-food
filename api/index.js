import { createApp } from '../server/app.js';

// 模組層級建立，讓同一個實例在多次呼叫間重用，
// 避免每次請求都重建 Express 與資料庫連線池
const app = createApp({ serveStatic: false });

export default function handler(req, res) {
  // vercel.json 把 /api/* 重寫到這個函式。依重寫的處理方式不同，
  // req.url 可能已經被去掉 /api 前綴，這裡補回來讓 Express 的路由一致。
  if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url === '/' ? '' : req.url}`;
  }
  return app(req, res);
}

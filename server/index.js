import { createApp } from './app.js';

// 一般 Node 主機的進入點：同時提供 API 與前端靜態檔。
// Vercel 走的是 api/index.js，不會經過這裡。
const app = createApp({ serveStatic: true });

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${port}`);
});

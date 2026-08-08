# 一起訂 — 團購訂餐系統

一群同事或朋友一起訂餐：有人開團指定店家，其他人用團號加入、各自點餐並填上名字，時間到關團，最後產出兩份彙總——一份給店家叫餐，一份給收錢的人。

架構設計見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 技術

| 層 | 技術 |
|---|---|
| 前端 | React 19 + Vite + Tailwind v4 + React Router |
| 後端 | Node + Express 5 + `pg` |
| 資料庫 | Postgres（Neon） |
| 部署 | Zeabur（單一 Node 服務，同時提供 API 與靜態檔） |

前端為手機優先設計，版面最大 500px 置中。

## 本機開發

```bash
# 1. 安裝
npm install

# 2. 設定資料庫連線
cp .env.example .env
#    到 https://neon.tech 建立免費專案，把 pooled connection string 填進 DATABASE_URL

# 3. 建立資料表與測試資料
npm run migrate
npm run seed

# 4. 啟動（後端 :3000、前端 :5173，Vite 會把 /api 代理到後端）
npm run dev
```

開啟 http://localhost:5173

## 驗證

```bash
npm run dev:server   # 另開一個終端機
npm run smoke        # 端對端測試
```

`smoke` 會實際打 API 驗證價格信任模型、權限、關團與截止時間等行為，測試資料以 `[smoke]` 開頭並在結束後自動清除。

## 部署到 Zeabur

1. 推上 GitHub，在 Zeabur 建立服務指向此 repo
2. 環境變數設定 `DATABASE_URL`（Neon pooled connection string）
3. `PORT` 由 Zeabur 自動注入，不需設定
4. 部署後在本機執行一次 `npm run migrate` 建立資料表（或改用 Zeabur 的 console）

`zbpack.json` 已設定好 build 與 start 指令。

## 專案結構

```
server/
├── index.js              Express 啟動、靜態檔、SPA fallback、錯誤處理
├── db.js                 連線池與 transaction helper
├── lib/
│   ├── pricing.js        價格信任模型（核心）
│   ├── validate.js       zod schema
│   ├── serialize.js      DB row → API 回應、彙總計算
│   ├── codes.js          團號產生
│   └── errors.js
├── routes/{stores,groups,orders}.js
├── migrations/           SQL migration 與執行器
├── seed.js               測試店家與菜單
└── smoke.js              端對端測試

client/src/
├── pages/{Home,NewGroup,Group,Stores}.jsx
├── components/{ui,OrderTab,PeopleList,Summary}.jsx
└── lib/{api,storage}.js
```

## 兩個要知道的設計

**價格信任模型**（`server/lib/pricing.js`）

本系統允許使用者自填菜名與價格，因此不能像一般點餐系統那樣完全不信任前端，但也不該全盤開放。判斷依據是前端有沒有送 `menuItemId`：

- 有 → 忽略前端送的名稱與價格，一律以 `menu_items` 為準，並驗證品項屬於本團店家且未下架
- 無 → 視為自填品項，採用前端的值，但限制長度與金額範圍

`total` 永遠由伺服器重算，前端送來的金額一律丟棄。

**沒有帳號系統**

團購的價值在零阻力，要求註冊會直接殺掉使用率。改用三種憑證：`join_code`（分享用短碼）、`edit_token`（改自己的單）、`admin_token`（開團者關團與代刪）。後兩者存在 localStorage，換裝置會遺失，此時由開團者代為處理。

權限判斷一律在後端，前端的 token 只決定按鈕顯示與否。

## 已知事項

- **Neon 連線可能 ETIMEDOUT**：Neon endpoint 同時有 A 與 AAAA 記錄，Node 20 起預設啟用的 `autoSelectFamily`（Happy Eyeballs）在沒有可用 IPv6 路由的網路上會嘗試 IPv6 後卡住且不 fallback。`server/db.js` 已用 `net.setDefaultAutoSelectFamily(false)` 搭配 `dns.setDefaultResultOrder('ipv4first')` 處理。若日後把資料庫連線搬到其他檔案，記得沿用。
- `DATABASE_URL` 請使用 **pooled** endpoint（主機名稱含 `-pooler`）。

- `react-router-dom` 有一則 RSC 模式的 CSRF 公告（GHSA-qwww-vcr4-c8h2），影響 7.12.0–8.2.0 且目前無修補版本。本專案為純 client SPA，未使用 RSC 或 server actions，該路徑不可達。
- 知道團號的人可以看到團內所有人的訂單。辦公室情境下這本來就是公開資訊。
- 自填品項的價格無法由系統核對，彙總頁會標示「自填」提醒大家確認。

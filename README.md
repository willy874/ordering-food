# 聚會點餐機 — 出遊點餐與分帳

一群人出去玩，到店後各自用自己的手機開同一個連結點餐，最後彙總分帳：一份給店家叫餐，一份算每個人要付多少。

進場先登記一個暱稱，之後就用這個身分點餐。逐項可以標進度（未點單／已點單／已到餐／撤單）、寫備註，也可以指定某一樣由誰一起分擔——一瓶酒全桌平分，或只跟旁邊那兩個人分。「清單」頁看得到全桌點了什麼與整體進度；結帳頁除了叫餐清單與每人應付，還有一張分單一覽，交代每筆金額是怎麼算出來的。

發起人可以把「管理代碼」念給幫忙的人，或直接在清單頁勾選某個參與者當管理者——管理者能代改所有人的單、跟店家點完後一次推進度，但關不了攤也刪不掉。

**線上位址：https://ordering-food-mu.vercel.app**

架構設計見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，API 完整參考（含用程式批次改菜單的做法）見 [`docs/API.md`](docs/API.md)，後續功能規劃見 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 技術

| 層 | 技術 |
|---|---|
| 前端 | React 19 + Vite + MUI 7 + React Router |
| 後端 | Node 22 + Express 5 + `pg` |
| 資料庫 | Neon Postgres（新加坡） |
| 部署 | Vercel（新加坡 `sin1`） |

前端為手機優先設計，版面最大 500px 置中。

---

# 部署

## 拓撲

```
              使用者（台灣）
                    │
                    ▼
┌─────────────────────────────────────────┐
│  Vercel — sin1（新加坡）                  │
│                                         │
│  CDN         client/dist  React 靜態檔    │
│  Function    api/index.js  Express API   │
└─────────────────────────────────────────┘
                    │  約 2ms（同區）
                    ▼
┌─────────────────────────────────────────┐
│  Neon — ap-southeast-1（新加坡）          │
│  Postgres 18，pooled endpoint            │
└─────────────────────────────────────────┘
```

## 為什麼這樣配置

**App 與資料庫同區，而不是靠近使用者。**

一次頁面載入會打三次資料庫，跨區成本要乘以三。實測比較（從台灣）：

| 配置 | 使用者→App | App→DB ×3 | 實際總延遲 |
|---|---|---|---|
| **新加坡 + 新加坡（目前）** | 50ms | 約 6ms | **約 200ms** |
| 台北 + 美東 Neon | 10ms | 600ms | 約 610ms |
| 加州 + 美東 Neon | 130ms | 195ms | 約 325ms |

台北機房離使用者最近，但每次查詢都要跨太平洋，反而最慢。

**選 Vercel 而非其他免費平台**，關鍵在冷啟動。Render 免費方案閒置 15 分鐘休眠、喚醒 30–60 秒；一群人坐在餐廳裡同時開連結，第一個人等一分鐘是不能接受的。Vercel 實測穩定在 200ms 上下，沒有長尾。

（其他曾評估的選項：Zeabur 已停用共享叢集，最低需租 $3/月伺服器；Fly.io 新帳號只剩 2 小時試用；Koyeb 已取消免費運算。）

## 一份程式碼，兩種執行方式

Express app 的「組裝」與「監聽」是分開的，讓同一份路由能在兩種環境執行：

```
server/app.js          createApp()，只組裝不監聽
  ├── server/index.js    一般 Node 主機：Express 同時提供 API 與靜態檔
  └── api/index.js       Vercel：靜態檔由 CDN 送出，函式只處理 /api/*
```

`server/routes/*` 與所有商業邏輯完全不知道自己跑在哪裡。要換回一般 Node 主機（Zeabur、Render、自架 VPS）時，`server/index.js` 這條路徑仍然完整可用，`zbpack.json` 也保留著。

**兩個 serverless 專屬的處理：**

`api/index.js` 會在 `req.url` 缺少 `/api` 前綴時補回。Vercel 的重寫在某些情況會去除前綴，兩種形態都要能正確路由。

`server/db.js` 在偵測到 `process.env.VERCEL` 時把連線池上限設為 1。每個函式實例都是獨立程序、可能同時存在數十個，各開一池會很快耗盡 Postgres 連線數；真正的併發交由 Neon 的 pooler 處理。

## vercel.json

```json
{
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": "client/dist",
  "regions": ["sin1"],
  "functions": { "api/index.js": { "maxDuration": 15 } },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

重寫規則依序比對，且只在檔案系統找不到對應檔案時才套用。因此 `/assets/*` 直接由 CDN 送出，`/api/*` 進函式，其餘（如 `/g/K7M2QX`）落到 `index.html` 交給前端路由 —— 深層路由重新整理不會 404。

## 環境變數

| 變數 | 設定於 | 說明 |
|---|---|---|
| `DATABASE_URL` | Vercel（Production／Preview／Development） | Neon **pooled** 連線字串，主機名稱須含 `-pooler` |
| `PORT` | 僅本機與一般 Node 主機 | Vercel 不需要 |

前端沒有任何環境變數 —— API 與前端同源，不需要 base URL。

## 首次部署

```bash
# 1. 登入（會開瀏覽器）
npx vercel login

# 2. 連結專案
npx vercel link --yes --project ordering-food

# 3. 設定資料庫連線（三個環境各設一次）
npx vercel env add DATABASE_URL production
npx vercel env add DATABASE_URL preview
npx vercel env add DATABASE_URL development

# 4. 部署
npx vercel deploy --prod --yes
```

## 後續部署

目前**尚未連結 GitHub 自動部署**，每次要手動：

```bash
npx vercel deploy --prod --yes     # 正式環境
npx vercel deploy --yes            # 預覽環境
```

要改成 push 即部署，到 Vercel 專案設定連結 GitHub repo（需在 repo 安裝 Vercel 的 GitHub App）。

## 資料庫 migration

Migration 從本機對資料庫執行，不在部署流程中自動跑：

```bash
npm run migrate
```

因為 Vercel 的建置環境不保證能連到資料庫，且自動 migration 在多實例部署時可能同時執行。目前正式與本機共用同一個 Neon 資料庫；要隔離的話可用 Neon 的 branch 功能開一個 dev 分支。

## 驗證部署

```bash
URL=https://ordering-food-mu.vercel.app

curl -s $URL/api/health                     # {"ok":true}
curl -s $URL/api/stores                     # 應回菜單資料
curl -s $URL/api/nope                       # 應為 404 JSON，不是 HTML
curl -so /dev/null -w "%{http_code}\n" $URL/g/ABC123   # 應為 200，不是 404

# 完整的 63 項端對端測試打在線上環境
SMOKE_BASE_URL=$URL npm run smoke
```

`smoke` 的測試資料以 `[smoke]` 開頭並在結束後自動清除，可安全對正式環境執行。

---

# 本機開發

```bash
# 1. 安裝
npm install

# 2. 設定資料庫連線
cp .env.example .env
#    到 https://neon.tech 建立免費專案，把 pooled connection string 填進 DATABASE_URL

# 3. 建立資料表與初始資料
npm run migrate
npm run seed

# 4. 啟動（後端 :3000、前端 :5173，Vite 會把 /api 代理到後端）
npm run dev
```

開啟 http://localhost:5173，手機測試用同網段 IP 連 `http://<內網IP>:5173`（`dev` 已帶 `--host`）。

## 測試

```bash
npm run dev:server   # 另開一個終端機
npm run smoke        # 63 項端對端測試
```

驗證價格信任模型、權限控制、訂單狀態機、撤單金額排除、同名擋單、關團與截止時間等行為。

---

# 專案結構

```
api/
└── index.js              Vercel serverless 進入點

server/
├── app.js                createApp()，組裝 Express（不監聽）
├── index.js              一般 Node 主機進入點
├── db.js                 連線池與 transaction helper
├── lib/
│   ├── auth.js           身分判定：本人／管理者／發起人
│   ├── pricing.js        價格信任模型
│   ├── orderStatus.js    訂單狀態機與轉移規則
│   ├── split.js          分單金額重算
│   ├── validate.js       zod schema
│   ├── serialize.js      DB row → API 回應、彙總計算
│   ├── codes.js          代碼產生（團號、管理代碼）
│   └── errors.js
├── routes/{stores,groups,orders}.js
├── migrations/           SQL migration 與執行器
├── seed.js               初始店家與菜單
└── smoke.js              端對端測試

client/src/
├── theme.js              MUI theme（色票、圓角、44px 觸控下限）
├── pages/{Home,NewGroup,Group,Stores}.jsx
├── components/{ui,OrderTab,ItemStatusChip,ItemEditDialog,ShareSelect,
│               GroupManage,PeopleList,Summary}.jsx
└── lib/{api,storage,orderStatus}.js
```

# 核心設計

**價格信任模型**（`server/lib/pricing.js`）

系統允許自填菜名與價格，因此不能完全不信任前端，但也不該全盤開放。判斷依據是有沒有送 `menuItemId`：

- 有 → 忽略前端送的名稱與價格，一律以 `menu_items` 為準，並驗證品項屬於本攤店家且未下架
- 無 → 視為自填品項，採用前端的值，但限制長度與金額範圍

`total` 永遠由伺服器重算。

**訂單狀態機**（`server/lib/orderStatus.js`）

`未點單 → 已點單 → 已到餐`，另有 `待撤單 → 已撤單`。保留回退路徑以因應現場誤操作，但不允許跳關。**已撤單不列入結帳金額與叫餐清單** —— 這是狀態功能的重點，撤掉的單若仍計入總額，收錢時會多收。

**沒有帳號系統**

零阻力是這個工具的價值來源。改用四種憑證：`join_code`（分享用短碼）、`edit_token`（改自己的單）、`manage_code`（8 碼，代改全攤的單）、`admin_token`（發起人：關攤、刪攤、指派管理者）。除了 `join_code` 都存在 localStorage，換裝置會遺失，此時由發起人代為處理。權限判斷一律在後端（`server/lib/auth.js`）。

**同攤不允許同名**

彙總按名字結算收錢，兩個「小明」是實質錯帳而非顯示問題，以唯一索引強制區隔。

**暱稱要先登記**（`client/src/components/OrderTab.jsx`）

第一次進一攤要先填暱稱，登記出來的是一張還沒有品項的訂單；之後點餐一律用這個身分，不再每次重打名字。先前每次送單都要填名字，打成「小明」「小明 」「明」時結帳就多出三個人。有身分還有第二個用途：別人要把東西分給你一起付，得先選得到你。

**分單**（`server/lib/split.js`）

一瓶酒、一份大拼盤不是一個人吃的，記在誰頭上都會讓那個人被多收。每個品項自己說明該分給誰：只有自己、全部平分，或指定的幾個人。

金額**不存進資料庫**，一律在讀取時依當下的參與者重算——「全部平分」的分母會變，寫死就得回頭更新一票不相干的列，漏一列就是一筆對不起來的帳。除不盡的零頭以一元為單位輪流分配，總和永遠等於原金額。

因此結帳有兩個數字：`ownTotal`（他點了多少）與 `payable`（他要付多少）。**收錢看 `payable`**。

**備註分兩層**

整張單的通則（「我晚點到」）掛在訂單上，單樣東西的要求（「不要香菜」）掛在品項上。一個人點三樣時，只有訂單層級的備註講不清楚是哪一樣，而叫餐清單合併相同品項時也要把備註算進合併鍵，否則「排骨飯 ×2」會把「不要香菜」那份吃掉。

**發起人與管理者可以代改單一品項**

數量、品名、價格、備註、分單都能動，而且不受截止時間限制——改錯的價、補漏的備註、把某一樣挪去分帳，幾乎都發生在結束點餐之後。

**管理者這一層**（`server/lib/auth.js`）

發起人自己也在吃飯，收拾殘局的常常是坐他旁邊那個人。但把 `admin_token` 給出去等於連刪攤的權力一起給，而且 uuid 沒辦法用嘴巴念。管理者因此有兩條等價的來源：把 8 碼的**管理代碼**念給誰（不必事先登記，適合幫忙結帳的人），或在清單頁**直接勾選**某個已登記的參與者（用他自己的 `edit_token` 就有權限，隨時可以收回）。分界線在「這一攤的生死」——關攤、改截止、刪攤、指派管理者只有發起人做得到。

**點過的東西，本人就不能再改品名與數量**

品項一旦離開「未點單」，店家那邊已經記下了品名與數量，App 這邊再改只會讓兩份單對不起來。要多點請另外加一筆，不要了請走撤單（本人也不能直接刪掉已點單的品項，否則刪掉重加就繞過了）。**價格、備註與分單不在限制內**——自填品項常常是「先點了，結帳才知道多少錢」，鎖住只會把工作全推回發起人身上。發起人與管理者不受此限。

# 已知事項

- **Neon 連線可能 ETIMEDOUT**：Neon endpoint 同時有 A 與 AAAA 記錄，Node 20 起預設啟用的 `autoSelectFamily`（Happy Eyeballs）在沒有可用 IPv6 路由的網路上會嘗試 IPv6 後卡住且不 fallback。`server/db.js` 已用 `net.setDefaultAutoSelectFamily(false)` 搭配 `dns.setDefaultResultOrder('ipv4first')` 處理。若日後把資料庫連線搬到其他檔案，記得沿用。
- `DATABASE_URL` 必須使用 **pooled** endpoint（主機名稱含 `-pooler`），serverless 環境尤其重要。
- Vercel Hobby 方案條款為**非商業用途**。
- 知道代碼的人可以看到該攤所有人的訂單。朋友一起出遊的情境下這本來就是共享資訊。
- 自填品項與標記「價格待確認」的品項無法由系統核對金額，彙總會標示估算部分佔多少。
- 本專案為 public repo，`.env` 由 `.gitignore` 排除；提交前務必確認資料庫憑證未進入版控。

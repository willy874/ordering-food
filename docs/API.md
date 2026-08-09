# API 完整參考

本文是後端 CRUD 的**操作手冊**，目的是讓你不開介面、直接用程式（curl / fetch / node script）就能改店家、改菜單、下單、改狀態、對帳。

- 架構與設計理由 → `docs/ARCHITECTURE.md`
- 實際實作 → `server/routes/{stores,groups,orders}.js`、`server/lib/validate.js`
- 前端已封裝好的呼叫 → `client/src/lib/api.js`（可當範例對照）

---

## 1. 連線資訊

| 環境 | Base URL |
|---|---|
| 線上（Vercel） | `https://ordering-food-mu.vercel.app/api` |
| 本機 | `http://localhost:3000/api`（`npm run dev:server`） |

所有請求與回應都是 JSON，request body 上限 100KB。要送 body 時必須帶 `Content-Type: application/json`。

健康檢查：

```bash
curl -s https://ordering-food-mu.vercel.app/api/health   # → {"ok":true}
```

以下範例都假設先設好變數：

```bash
URL=https://ordering-food-mu.vercel.app/api
```

---

## 2. 憑證與權限

沒有帳號系統，改用四種憑證（判定集中在 `server/lib/auth.js` 的 `resolveActor`，前端只用來決定按鈕顯不顯示）：

| 憑證 | 怎麼取得 | 放哪裡 | 對應角色 |
|---|---|---|---|
| `joinCode` | 開團回應，6 碼（`ABCDEFGHJKMNPQRSTUVWXYZ23456789`，排除易混淆字元） | URL path | 誰都算——讀團、讀全團訂單與彙總、下新單、改品項狀態 |
| `editToken` | 下單回應，uuid | HTTP header `X-Edit-Token` | 那張單的 `orders.role`，預設 `participant` |
| `manageCode` | 開團回應，8 碼、同一套字母表 | HTTP header `X-Manage-Code` | `manager`（協助管理者） |
| `adminToken` | 開團回應，uuid | HTTP header `X-Admin-Token` | `admin`（最高管理者），且是唯一刪得掉整攤的人 |

三個角色，權力由小到大（定義在 `server/lib/auth.js`）：

| 角色 | 能做什麼 |
|---|---|
| `participant` 參與者 | 只動得了自己那張單，**已離開 `pending` 的品項改不了品名與數量、也不能刪**；受截止時間限制 |
| `manager` 協助管理者 | 代改代刪**任何人**的訂單與品項、批次改狀態，不受截止時間與品項狀態限制 |
| `admin` 最高管理者 | 再加上 `PATCH /orders/:id/role`（指派別人的角色）、`PATCH /groups/:joinCode`（關攤／改截止）與 `DELETE /groups/:joinCode`（刪攤） |

多個憑證同時帶時取最高的那個。發起人恆為 `admin`，而且他的 `adminToken` 不在 `orders` 表裡，所以任何被指派出去的權限他都收得回來。

**兩個 token 都只在建立當下回傳一次**，之後任何查詢 API 都不會再吐出來（見 `server/lib/serialize.js` 的註解）。用程式操作時請自己存下來。`manageCode` 是唯一的例外：帶著 `X-Admin-Token`（或它自己）讀 `GET /groups/:joinCode` 就會回傳，因為發起人得看得到它才念得出去。

**管理權有兩條等價的來源。** 除了 `X-Manage-Code`，最高管理者也可以用 `PATCH /orders/:orderId/role` 指派某個已登記的參與者——那個人之後用他自己原本的 `X-Edit-Token` 就有權限。前者適合「幫忙結帳但沒點東西」的人，後者可以隨時收回，而且給得出 `admin`。

持 `manageCode` 的人**指派不了任何人**（只有 `admin` 可以）：代碼給出去就收不回來，能拿它再生出更多管理者的話就再也收束不了了。同理，被指派的 `admin` 也拿不到 `manageCode`。

`manageCode` 一律連同 `joinCode` 一起驗證，因此不必全域唯一；比對前會 trim 並轉大寫。**沒有速率限制**，靠的是 31⁸ ≈ 8.5×10¹¹ 的搜尋空間。

沒有任何憑證保護的端點：**店家與菜單全部的 CRUD**。這是刻意的（內部工具、彼此信任），也就是說任何知道網址的人都能改菜單——用程式批次改菜單時不需要帶 header。

---

## 3. 錯誤格式與狀態碼

失敗一律回這個形狀：

```json
{ "error": "價格上限 200000" }
```

| 狀態碼 | 來源 | 典型情境 |
|---|---|---|
| 400 | `badRequest` | 欄位驗證失敗、團已關閉／逾期、品項不屬於本團店家、品項已下架、狀態不可轉移 |
| 403 | `unauthorized` | token 缺少或不符 |
| 404 | `notFound` | 找不到店家／品項／團／訂單；**也包含 PATCH 菜單時沒帶任何欄位** |
| 409 | `conflict` | 同一團裡已經有同名的人下單 |
| 500 | 未預期錯誤 | 例如把非數字當成 `:id`（`/menu-items/abc`）會讓 Postgres 型別轉換失敗 |

驗證錯誤訊息會帶上欄位路徑，例如 `items.0.qty：Number must be less than or equal to 99`。

---

## 4. 通用驗證限制

出自 `server/lib/validate.js`，用程式送資料前先對照這張表可以省掉大部分 400。

| 欄位 | 限制 |
|---|---|
| 店家 `name` | 1–50 字 |
| 店家 `phone` | ≤ 30 字，可 null |
| 店家 `note` | ≤ 200 字，可 null |
| 菜單 `name` | 1–50 字 |
| 菜單 `price` | 整數 0–200000（原本是 9999，為了整支酒與套餐放寬） |
| 菜單 `category` | ≤ 20 字，省略時預設 `主餐` |
| 菜單 `sortOrder` | 整數，省略時預設 0 |
| 團 `title` | 1–50 字 |
| 團 `hostName` | 1–20 字 |
| `manageCode` | 4–16 字，比對前 trim + 轉大寫（開團產生的一律是 8 碼） |
| `deadlineAt` | ISO 8601 **且必須帶時區位移**，如 `2026-08-08T12:30:00+08:00` 或 `...Z`；可 null |
| 訂單 `personName` | 1–20 字，**同團不可重複**（這是登記的暱稱） |
| 訂單 `note` | ≤ 200 字，可 null（整張單的通則） |
| 訂單 `items` | 0–30 個（**0 個 = 只登記暱稱**）；一張單累積上限 60 個 |
| 品項 `qty` | 整數 1–99 |
| 品項 `note` | ≤ 100 字，可 null（這一樣的要求） |
| 品項 `shareScope` | `owner` / `all` / `custom`，省略時預設 `owner` |
| 品項 `sharedWith` | uuid 陣列，≤ 50 個，且必須是**同一團**的 orderId |
| 自填 `unitPrice` | 整數 0–200000 |

金額一律是**整數台幣元**，沒有小數。

---

## 5. 資源欄位對照

API 用 camelCase，DB 用 snake_case，轉換都在 `server/lib/serialize.js`。

### Store

```jsonc
{
  "id": 1,              // bigint
  "name": "橙店 OG CLUB",
  "phone": "0925-199-522",
  "note": "高雄市苓雅區中正二路165號・11:00-04:00・日咖夜酒",
  "active": true        // false = 已刪除（軟刪除），不會出現在列表
}
```

### MenuItem

```jsonc
{
  "id": 12,
  "storeId": 1,
  "name": "紅燒牛肉麵",
  "price": 220,
  "category": "主食",
  "available": true,       // false = 下架，仍會出現在 GET 回應裡
  "sortOrder": 30,
  "priceUncertain": false  // true = 價格待確認，彙總會標示總額為估算
}
```

### Group

```jsonc
{
  "id": "0e2f…",          // uuid
  "joinCode": "K7M2QX",
  "title": "週三午餐",
  "hostName": "小明",
  "status": "open",       // open | closed
  "deadlineAt": null,
  "createdAt": "2026-08-08T03:10:22.031Z",
  "store": { "id": 1, "name": "橙店 OG CLUB", "phone": "0925-199-522" },
  "manageCode": "5PV2XXAD" // 只有帶 X-Admin-Token 或 X-Manage-Code 讀才會出現
}
```

### Order / OrderItem

```jsonc
{
  "id": "b31c…",              // uuid
  "personName": "小明",        // 登記的暱稱，本團唯一
  "role": "participant",       // participant / manager / admin，見 §2
  "note": "我晚點到",           // 整張單的通則
  "total": 400,                // 自己點的金額，排除已撤單品項
  "payable": 310,              // 實際要付多少（已含分單），收錢看這個
  "ownPayable": 250,           // payable 裡屬於自己點的那部分
  "sharedIn": 60,              // 分擔別人品項的金額
  "sharedOut": 150,            // 自己點的東西裡由別人分走的金額
  "payablePriceUncertain": false,
  "cancelledTotal": 90,        // 已撤單品項的金額，另計
  "status": "pending",         // 由品項推導，取最落後的那一項；不是欄位
  "statusCounts": { "pending": 1, "ordered": 0, "served": 1,
                    "cancel_requested": 0, "cancelled": 1 },
  "itemCount": 2,              // 未撤單品項的數量合計
  "counted": true,             // false = 整張都撤掉或空單，不計入人數與金額
  "priceUncertain": false,
  "createdAt": "2026-08-08T03:11:40.000Z",
  "items": [
    {
      "id": 88,
      "menuItemId": 12,        // null = 自填品項
      "name": "紅燒牛肉麵",
      "unitPrice": 220,
      "qty": 1,
      "note": "不要香菜",       // 這一樣的要求
      "isCustom": false,       // 由 menuItemId is null 推導
      "priceUncertain": false,
      "status": "served",      // 狀態屬於品項，同一張單裡可以各自不同
      "statusChangedAt": "2026-08-08T03:12:00.000Z",
      "counted": true,         // false = 已撤單，不計入金額
      "subtotal": 220,
      "shareScope": "owner",   // owner / all / custom
      "sharedWith": [],        // custom 時的「其他人」orderId，不含自己
      "shared": false,         // 付款人多於一個
      "payers": [              // 伺服器算好的實際分攤，總和 = subtotal
        { "orderId": "b31c…", "personName": "小明", "amount": 220 }
      ]
    }
  ]
}
```

**狀態屬於品項，不屬於訂單。** 聚會是一輪一輪點的：先點的已經到餐時，後加的還沒跟店家開口。`orders` 沒有 status 欄位，上面那個 `status` 是伺服器由品項推導出來的顯示值——有一樣還沒點，整張單就算還沒點完。

**`total` 與 `payable` 是兩件事。** `total` 是「這個人點了多少」，`payable` 是「這個人要付多少」。沒有分單時兩者相同；一有分單就會岔開，**收錢一律看 `payable`**。

**分單金額不存在資料庫裡。** `payers` 與 `payable` 都是讀取當下依全團的參與者算出來的（`server/lib/split.js`）。`shareScope: "all"` 的分母會隨著有人登記或退出而變，所以沒有一個「當初算好的金額」可以拿來存。除不盡的零頭以一元為單位輪流分配，**每個品項 payers 的 amount 相加永遠等於 subtotal**。

**空單是合法的。** 只登記暱稱、還沒點東西的人就是一張 `items: []` 的單。它有身分（可以被選進別人的分單），但 `counted: false`，不計入人數。

---

## 6. 店家 CRUD

### `GET /stores` — 列出店家

只回 `active = true`，依 `name` 排序。無需憑證。

```bash
curl -s $URL/stores
```

### `POST /stores` — 新增店家 → 201

```bash
curl -s -X POST $URL/stores -H 'Content-Type: application/json' -d '{
  "name": "新店家",
  "phone": "07-1234567",
  "note": "營業時間 11:00-21:00"
}'
```

回傳完整 Store（含新的 `id`）。`phone`、`note` 可省略。

### `DELETE /stores/:id` — 刪除店家 → 204

**軟刪除**（`active = false`）。菜單、歷史團與訂單都留著，只是不再出現在 `GET /stores`。找不到 id 回 404。

沒有「更新店家」的端點——要改名字或電話目前只能直接改資料庫（見 §11）。

---

## 7. 菜單 CRUD

### `GET /stores/:id/menu` — 取得菜單

依 `category, sort_order, id` 排序。**包含 `available: false` 的下架品項**，過濾是前端的責任。

```bash
curl -s $URL/stores/1/menu | jq '.[] | {id, name, price, category}'
```

### `POST /stores/:id/menu` — 新增品項 → 201

```bash
curl -s -X POST $URL/stores/1/menu -H 'Content-Type: application/json' -d '{
  "name": "麻婆豆腐",
  "price": 280,
  "category": "撩胃餐食",
  "sortOrder": 130,
  "priceUncertain": false
}'
```

`category` 省略 → `主餐`；`sortOrder` 省略 → 0；`priceUncertain` 省略 → false。店家不存在回 404。

### `POST /stores/:id/menu/bulk` — 一次匯入整份菜單 → 201

換一家店時逐樣 POST 要打幾十次，而菜單通常已經以某種表格形式存在。這一支吃一個陣列，格式與單筆新增完全相同。

```bash
curl -s -X POST $URL/stores/1/menu/bulk -H 'Content-Type: application/json' -d '{
  "items": [
    { "name": "滷肉飯", "price": 45, "category": "主食", "sortOrder": 10 },
    { "name": "本日湯品", "price": 0, "priceUncertain": true }
  ]
}'
```

```jsonc
{ "created": 2, "items": [ /* MenuItem[] */ ] }
```

- **整批成立或整批退回**：跑在一個 transaction 裡，有一列不合法就整批 400，不會留下匯入到一半的菜單。
- 1–300 個品項，超過或空陣列都 400。店家不存在 404。
- `sortOrder` 省略時**照陣列順序**接在既有品項後面（既有數量 × 10 起跳，每筆 +10），因為貼上來的順序通常就是菜單上的順序。
- **只會新增，不會清空既有品項**。沒有「先清空再匯入」的選項——那會把既有品項連同歷史訂單的參照一起刪掉（`menu_item_id` 變 null）。

前端的 CSV 貼上介面（`client/src/lib/menuCsv.js`）解析完之後就是打這一支。CSV 欄位為 `品名,價格,分類,排序,價格待確認`，解析放在前端是因為要先讓使用者看到「這 23 樣會進去、第 5 行有問題」才敢按下去。

### `PATCH /menu-items/:id` — 修改品項

只送要改的欄位，可用：`name`、`price`、`category`、`available`、`sortOrder`、`priceUncertain`。

```bash
# 改價
curl -s -X PATCH $URL/menu-items/12 -H 'Content-Type: application/json' -d '{"price":240}'

# 下架（比刪除安全，見下方警告）
curl -s -X PATCH $URL/menu-items/12 -H 'Content-Type: application/json' -d '{"available":false}'

# 價格確認了，把待確認標記拿掉
curl -s -X PATCH $URL/menu-items/12 -H 'Content-Type: application/json' -d '{"price":260,"priceUncertain":false}'
```

回傳更新後的完整 MenuItem。一個欄位都沒送會得到 `404 沒有要更新的欄位`（狀態碼確實是 404，不是 400）。

### `DELETE /menu-items/:id` — 刪除品項 → 204

⚠️ **硬刪除，會影響歷史訂單的呈現。** `order_items.menu_item_id` 是 `on delete set null`，而 `is_custom` 是由 `menu_item_id is null` 推導的 generated column，所以刪掉菜單品項後，過去點過它的訂單品項會變成「自填」（介面上會多一個自填標籤）。金額與名稱不受影響（下單當下已快照）。

**要停售請用 `PATCH {"available": false}`，不要 DELETE。**

---

## 8. 團 CRUD

### `POST /groups` — 開團 → 201

```bash
curl -s -X POST $URL/groups -H 'Content-Type: application/json' -d '{
  "storeId": 1,
  "title": "週五宵夜",
  "hostName": "小明",
  "deadlineAt": "2026-08-08T22:00:00+08:00"
}'
```

```jsonc
{ "id": "0e2f…", "joinCode": "K7M2QX", "adminToken": "8c1d…",
  "manageCode": "5PV2XXAD", "reused": false }
```

- `adminToken` 只有這裡會出現，務必存下來。
- `manageCode` 是給幫忙改單的人的（見 §2）；之後帶 `X-Admin-Token` 讀團也拿得回來。
- 店家必須存在且 `active`，否則 400。
- **90 秒去重**：同店家 + 同團名 + 同開團者且在 90 秒內 → 不開新團，回傳既有的那個並帶 `reused: true`。條件收得緊是為了不誤判「每週都叫同一個團名」。用腳本連續建測試團時要注意這點（改團名或間隔超過 90 秒）。

### `GET /groups?storeId=&title=` — 查同名的收單中團

給前端開團前提醒用。兩個參數都必填，缺一個回 400。回最近 5 筆 `status = 'open'` 的同店同名團。

```bash
curl -s "$URL/groups?storeId=1&title=$(printf '%s' '週五宵夜' | jq -sRr @uri)"
```

```jsonc
[{ "joinCode": "K7M2QX", "title": "週五宵夜", "hostName": "小明",
   "createdAt": "…", "deadlineAt": null, "orderCount": 3 }]
```

### `GET /groups/:joinCode` — 團的完整快照

**這是最有用的一支讀取 API**，一次拿到四塊資料：

```jsonc
{
  "group":   { /* Group */ },
  "menu":    [ /* MenuItem[]，含下架品項 */ ],
  "orders":  [ /* Order[]，含 items，依 createdAt 排序 */ ],
  "summary": { /* 見 §10 */ }
}
```

`joinCode` 不分大小寫（後端會 `toUpperCase()`）。找不到回 404。無需憑證——但帶了 `X-Admin-Token` 或 `X-Manage-Code` 時，`group` 會多一個 `manageCode` 欄位。

```bash
curl -s $URL/groups/K7M2QX | jq '.summary.byItem'

# 發起人拿回管理代碼
curl -s $URL/groups/K7M2QX -H "X-Admin-Token: $ADMIN" | jq '.group.manageCode'
```

### `POST /groups/:joinCode/manage-code` — 驗證管理代碼

給前端在使用者輸入代碼的當下就告訴他打對了沒有，不必等到按下某顆按鈕才失敗。**這一支不發任何憑證**——代碼本身就是憑證，驗過之後每次寫入都帶 `X-Manage-Code` 即可。

```bash
curl -s -X POST $URL/groups/K7M2QX/manage-code \
  -H 'Content-Type: application/json' -d '{"manageCode":"5pv2xxad"}'
```

```jsonc
{ "joinCode": "K7M2QX", "manageCode": "5PV2XXAD" }
```

不分大小寫、自動 trim。代碼不對回 403。

### `PATCH /groups/:joinCode` — 關攤／改截止 `[最高管理者]`

```bash
# 關團
curl -s -X PATCH $URL/groups/K7M2QX \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $ADMIN" \
  -d '{"status":"closed"}'

# 改截止時間（null = 取消截止）
curl -s -X PATCH $URL/groups/K7M2QX \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $ADMIN" \
  -d '{"deadlineAt":"2026-08-08T23:30:00+08:00"}'
```

`status` 只能是 `open` / `closed`（可以再改回 `open` 重新收單）。兩個欄位都沒送回 400。回傳更新後的 Group——但只有帶 `X-Admin-Token`（或 `X-Manage-Code`）時才含 `manageCode`，被指派的最高管理者拿不到。

### `DELETE /groups/:joinCode` — 刪攤 `[最高管理者]` → 204

`orders` 與 `order_items` 都是 cascade，會一併消失，**不可復原**。`manager` 呼叫會 403。

被指派的 `admin` 也刪得掉——指派最高管理者就是把「跟我同級」這件事講明了。權力交出去之前想清楚，這一項沒有回頭路。

---

## 9. 訂單 CRUD

### `POST /groups/:joinCode/orders` — 登記暱稱／下單 → 201

不需要憑證（知道團號就能下單）。

**這個端點同時是「登記暱稱」**：`items` 可以省略或給空陣列，建出來的就是一張沒有品項的單。要先有單才有身分——別人得選得到你，才能把品項分給你一起付。

```bash
# 只登記
curl -s -X POST $URL/groups/K7M2QX/orders -H 'Content-Type: application/json' \
  -d '{"personName":"小明"}'

# 登記兼下單
curl -s -X POST $URL/groups/K7M2QX/orders -H 'Content-Type: application/json' -d '{
  "personName": "小明",
  "note": "我晚點到",
  "items": [
    { "menuItemId": 12, "qty": 1, "note": "不要香菜" },
    { "name": "自己買的珍奶", "unitPrice": 60, "qty": 2, "priceUncertain": false },
    { "menuItemId": 30, "qty": 1, "shareScope": "all" },
    { "menuItemId": 31, "qty": 1, "shareScope": "custom", "sharedWith": ["<orderId>"] }
  ]
}'
```

```jsonc
{ "orderId": "b31c…", "editToken": "5f9a…", "total": 340 }
```

**價格信任模型**（`server/lib/pricing.js`）：

| items 元素形態 | 伺服器行為 |
|---|---|
| 有 `menuItemId` | **忽略**你送的 `name` / `unitPrice` / `priceUncertain`，一律用 `menu_items` 的值；並驗證該品項屬於本團店家且 `available` |
| 無 `menuItemId` | 採用你送的 `name` + `unitPrice`（+ 可選 `priceUncertain`），`isCustom` 自動為 true |

`note` 與分單欄位兩種形態都照收——它們不影響價格，因此不受「一律以菜單為準」的限制。

**分單欄位**：

| 欄位 | 值 | 意思 |
|---|---|---|
| `shareScope` | `owner`（預設） | 只有點的人付 |
| | `all` | 全團平分，分母在**每次讀取時**才解析，之後才登記的人也會被算進去 |
| | `custom` | 點的人 ＋ `sharedWith` 列出的人 |
| `sharedWith` | orderId 陣列 | 只列**其他人**，不含點的人自己（他必然要付，而且下單當下自己的 orderId 還不存在）。最多 50 個 |

`custom` 但 `sharedWith` 為空會被正規化成 `owner`。

`total` 永遠由伺服器重算，送上來的金額一律丟棄。

會失敗的情況：團已 `closed` 或超過 `deadlineAt` → 400；品項不屬於本團店家或已下架 → 400；`sharedWith` 含有不在本團的 orderId → 400；`personName` 同團重複 → 409。

### 沒有「整筆覆蓋」的改單 API

覆蓋會把已經跟店家點過、甚至已經到餐的品項連同狀態一起洗掉。改單因此拆成三個各自獨立的動作：**加點只追加、改內容只動一列、刪除只刪一列**。這也是「已經送單後還能繼續點」能成立的前提。

### `PATCH /orders/:orderId` — 改名字／備註 `[本人或管理者以上]`

```bash
curl -s -X PATCH $URL/orders/$ORDER_ID \
  -H 'Content-Type: application/json' -H "X-Edit-Token: $EDIT" \
  -d '{"note":"改成不要辣"}'
```

回 `{ "orderId": "…" }`。兩個欄位都是可選，但至少要給一個，否則 400。品項完全不受影響。`personName` 撞到同團既有名字 → 409。

### `POST /orders/:orderId/items` — 加點 `[本人或管理者以上]` → 201

```bash
curl -s -X POST $URL/orders/$ORDER_ID/items \
  -H 'Content-Type: application/json' -H "X-Edit-Token: $EDIT" \
  -d '{"items":[{"menuItemId":12,"qty":1},{"name":"第二輪的酒","unitPrice":300,"qty":1}]}'
```

```jsonc
{ "orderId": "b31c…", "addedItemIds": [91, 92], "total": 730 }
```

- `items` 的格式與下單完全相同，**已經在單上的東西原封不動**。
- 新加的品項一律從 `pending`（未點單）開始，即使單上其他品項已經到餐。
- 一張單累積上限 60 個品項，超過 → 400。
- 團關閉或逾期後不能加點（發起人與管理者也不行）——收單結束就是結束，要補點請重新開放。

### `PATCH /orders/:orderId/role` — 指派角色 `[最高管理者]`

```bash
curl -s -X PATCH $URL/orders/$ORDER_ID/role \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $ADMIN" \
  -d '{"role":"manager"}'
```

```jsonc
{ "orderId": "b31c…", "personName": "小華", "role": "manager" }
```

`role` 只能是 `participant` / `manager` / `admin`，其他值 400。被指派的人之後用他自己的 `X-Edit-Token` 就有那個角色的權限。

- **只有 `admin` 呼叫得動**，`manager` 與持 `manageCode` 的人一律 403。
- `admin` 可以再指派 `admin`：發起人不會整晚盯著手機等別人來要權限。代價是他也可以把別人降回 `participant`，但發起人手上的 `adminToken` 不在這張表裡，永遠收得回來。
- 送 `{"role":"participant"}` 就是收回權限。

### `PATCH /order-items/:itemId` — 改單一品項 `[本人或管理者以上]`

```bash
curl -s -X PATCH $URL/order-items/88 \
  -H 'Content-Type: application/json' -H "X-Edit-Token: $EDIT" \
  -d '{"unitPrice":260}'
```

```jsonc
{ "item": { "id": 88, "menuItemId": null, "isCustom": true, … }, "total": 470 }
```

- 可改 `name` / `unitPrice` / `priceUncertain` / `qty` / `note` / `shareScope` / `sharedWith`，至少給一個。
- **只改 `qty`、`note` 或分單會保留與菜單的連結；一旦動到名稱或價格，這一列就轉成自填品項（`menuItemId` 變 null）**——菜單品項的名稱與價格一律以菜單為準，留著連結的話改的值會被蓋回去。
- 判斷依據是**值有沒有變**，不是欄位有沒有送。整個表單原樣送回來（只改了備註）不會把品項踢出菜單。
- 品項的 `status` 不會因為改內容而重設。
- 參與者受「團仍開著且未逾期」限制；**管理者以上不受限制**——改錯的價、補漏的備註、把某一樣挪去分帳，幾乎都發生在結束點餐之後。

**品項離開 `pending` 之後，本人就不能再改 `name` 與 `qty`** → 400。店家那邊已經記下品名與數量了，App 這邊再改只會讓兩份單對不起來；要多點請 `POST /orders/:id/items` 另外加一筆，不要了請把狀態改成 `cancel_requested`。

`unitPrice`、`priceUncertain`、`note`、`shareScope`、`sharedWith` **不在限制內**：自填品項常常是「先點了，結帳才知道多少錢」，分單也多半是結帳當下才喬。判斷依據同樣是值有沒有變，所以編輯表單把原本的品名數量原樣送回來不會被擋。管理者以上完全不受此限。

### `DELETE /order-items/:itemId` — 刪掉其中一樣 `[本人或管理者以上]` → 204

刪光一張單的所有品項不會連帶刪掉這張單，會留下一張空單（`counted: false`，不計入人數與金額）。參與者受「團仍開著且未逾期」限制，管理者以上不受限制。

**本人不能刪掉已經離開 `pending` 的品項** → 400，請改用撤單。否則「不能改品名數量」只要刪掉重加就繞過了，而且撤單才留得下紀錄。

### `DELETE /orders/:orderId` — 刪整張單 `[本人或管理者以上]` → 204

參與者受「團仍開著且未逾期」限制；**管理者以上不受限制**，關攤後仍可代刪，因為收拾殘局通常發生在關攤之後。

**單裡只要有一樣離開 `pending`，本人就不能整張刪掉** → 400（同上，避免繞過）。要退出請逐項撤單。

### `PATCH /order-items/:itemId/status` — 改品項狀態（**不需憑證**）

```bash
curl -s -X PATCH $URL/order-items/88/status \
  -H 'Content-Type: application/json' -d '{"status":"served"}'
```

```jsonc
{ "itemId": 88, "status": "served", "changed": true, "total": 470 }
```

- **全系統唯一不需要憑證的寫入。** 現場誰看到餐送上桌誰就能按——服務生把酒端來時，點的人可能正在廁所。拿得到團號就是同一桌的人，而且能改的只有進度，改不了金額與內容。
- **刻意不檢查團是否關閉**：關團之後餐才正要陸續送到，狀態必須還能推進。
- 撤單與復原會改變應付金額，所以回傳重算後的 `total`。
- 送相同狀態 → `changed: false`，不算錯誤。
- 不合法的轉移 → 400，訊息如「「未點單」不能直接改成「已到餐」」。

### `PATCH /orders/:orderId/status` — 整張單一次改（**不需憑證**）

把這張單裡所有轉移合法的品項一次推到同一個狀態，例如「我這單整個撤掉」。

```jsonc
{ "orderId": "b31c…", "status": "cancelled", "updated": 3, "skipped": 1, "total": 0 }
```

不合法的轉移會被略過而不是整批失敗，所以務必看 `skipped`。

### `PATCH /groups/:joinCode/orders/status` — 批次改狀態 `[管理者以上]`

主要用途：跟店家點完這一輪後，把全團「未點單」的品項一次標成「已點單」。

```bash
curl -s -X PATCH $URL/groups/K7M2QX/orders/status \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $ADMIN" \
  -d '{"from":"pending","to":"ordered"}'
```

```jsonc
{ "status": "ordered", "updated": 5, "skipped": 1,
  "message": "5 樣已改為「已點單」，1 樣因狀態不允許而略過" }
```

**對象是品項而非整張單**，所以只會動到還沒點的東西，上一輪已經到餐的不受影響。`from` 省略 = 全團所有品項都當候選。不合法的轉移會被略過而不是讓整批失敗。

### 品項狀態機

定義在 `server/lib/orderStatus.js`。

| 值 | 中文 | 意義 | 列入結帳金額 |
|---|---|---|---|
| `pending` | 未點單 | App 裡加好了，還沒跟店家開口 | ✅（預設值） |
| `ordered` | 已點單 | 已經跟店家點了 | ✅ |
| `served` | 已到餐 | 餐點送到了 | ✅ |
| `cancel_requested` | 待撤單 | 想取消，還沒跟店家講定 | ✅ |
| `cancelled` | 已撤單 | 確定取消 | ❌ |

允許的轉移（刻意保留回退路徑，現場一定會有按錯的時候）：

```
pending          → ordered, cancelled
ordered          → served, cancel_requested, pending
served           → ordered
cancel_requested → cancelled, ordered
cancelled        → pending          （誤撤的還原路徑）
```

注意 `pending → served` 不合法，要先 `ordered`。

整張單的狀態（`Order.status`）不是欄位，而是由品項推導：有一樣 `pending` 就算 `pending`，否則有 `ordered` 就算 `ordered`，其次 `cancel_requested`，全部到餐才是 `served`；品項全被撤掉才是 `cancelled`。實作在 `rollupStatus`。

---

## 10. 彙總（summary）結構

`GET /groups/:joinCode` 的 `summary`，由 `buildSummary()`（`server/lib/serialize.js`）即時計算，這是整個系統真正的產出。**`cancelled` 的訂單不計入金額**。

```jsonc
{
  "byItem": [                       // 給店家叫餐：合併所有人的相同品項
    { "name": "紅燒牛肉麵", "unitPrice": 220, "qty": 3, "subtotal": 660,
      "isCustom": false, "priceUncertain": false, "note": null }
  ],                                // 排序：菜單品項優先 → 數量多優先 → 名稱
  "pendingByItem": [                // 同上，但只含還沒跟店家點的 → 這一輪要加點的
    { "name": "生啤酒", "unitPrice": 150, "qty": 2, "subtotal": 300,
      "isCustom": false, "priceUncertain": false, "note": null }
  ],
  "byPerson": [                     // 給收錢的人（含已撤單者，用 counted 區分）
    { "orderId": "b31c…", "personName": "小明",
      "ownTotal": 400,              // 自己點了多少
      "payable": 310,               // 實際要付多少 ← 收錢看這個
      "ownPayable": 250, "sharedIn": 60, "sharedOut": 150,
      "status": "ordered", "counted": true, "itemCount": 2, "priceUncertain": false }
  ],
  "split": {                        // 分單一覽：解釋每個人的金額怎麼來的
    "people": [
      { "orderId": "b31c…", "personName": "小明", "ownTotal": 400,
        "ownPayable": 250, "sharedIn": 60, "sharedOut": 150, "payable": 310,
        "priceUncertain": false, "counted": true }
    ],
    "items": [                      // 只列被分著付的品項
      { "itemId": 91, "name": "一瓶紅酒", "qty": 1, "subtotal": 1200,
        "counted": true, "priceUncertain": false, "shareScope": "all",
        "ownerOrderId": "b31c…", "ownerName": "小明",
        "payers": [ { "orderId": "b31c…", "personName": "小明", "amount": 240 } ] }
    ],
    "hasShared": true,              // false = 各點各的，介面可整塊不顯示
    "total": 1980                   // 恆等於 grandTotal，對不上就是算錯了
  },
  "grandTotal": 1980,               // 只加總未撤單的品項
  "peopleCount": 5,                 // 要付錢的人數（含只分擔、自己沒點的人）
  "participantCount": 6,            // 登記在這一團的所有人，分單能選誰的依據
  "itemCount": 12,                  // byItem 的數量總和
  "uncertainSubtotal": 280,         // 其中有多少金額是「價格待確認」的估算
  "hasUncertainPrice": true,
  "statusCounts": { "pending": 1, "ordered": 4, "served": 0,
                    "cancel_requested": 0, "cancelled": 1 },  // 單位是「品項」
  "cancelledCount": 1,              // 已撤單的品項數
  "cancelledTotal": 180,
  "allServed": false                // 未撤單的品項全部 served 時為 true
}
```

`statusCounts`、`cancelledCount` 的單位都是**品項**而非訂單——狀態屬於品項，同一張單裡可以一樣已到餐、一樣還沒點。

`byItem` 的合併鍵是「是否自填 + 名稱 + 單價 + 是否待確認 + 備註」，所以同名但單價不同、或備註不同的品項不會被錯誤合併——「排骨飯 ×2」和「排骨飯（不要香菜）×1」對店家是兩件不同的事。

**`byPerson[].payable` 才是要收的錢**，`ownTotal` 只是「他點了多少」。沒有分單時兩者相同，一有分單就會岔開。`split.total` 與 `grandTotal` 必定相等，可以拿來當對帳的斷言（`server/smoke.js` 就是這樣驗的）。

`peopleCount` 算的是「要付錢的人」：只登記暱稱沒點東西的人不算，但若有人把品項分給他，他就算。`participantCount` 才是登記過的總人數。

---

## 11. 用程式批次改菜單

### 方式 A：走 HTTP API（線上資料、不需要 DB 連線字串）

菜單 CRUD 不需要憑證，所以一個小腳本就能改線上資料。存成 `scripts/menu.mjs` 之類的位置再 `node scripts/menu.mjs`：

```js
const URL = 'https://ordering-food-mu.vercel.app/api';

async function call(path, method = 'GET', body) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const [store] = (await call('/stores')).filter((s) => s.name.includes('OG CLUB'));
const menu = await call(`/stores/${store.id}/menu`);
const byName = new Map(menu.map((m) => [m.name, m]));

// 1. 補上確認過的價格，並清掉待確認標記
const fixes = { 冰鎮咕咾肉: 280, 章魚燒蝦餅: 220 };
for (const [name, price] of Object.entries(fixes)) {
  const item = byName.get(name);
  if (!item) { console.warn(`找不到 ${name}`); continue; }
  await call(`/menu-items/${item.id}`, 'PATCH', { price, priceUncertain: false });
  console.log(`✓ ${name} → ${price}`);
}

// 2. 新增品項（注意 sortOrder 只在同一 category 內生效）
await call(`/stores/${store.id}/menu`, 'POST', {
  name: '新品項', price: 200, category: '撩胃餐食', sortOrder: 999,
});

// 3. 停售：用 available:false，不要 DELETE（DELETE 會讓歷史訂單變成「自填」）
const gone = byName.get('南南雞');
if (gone) await call(`/menu-items/${gone.id}`, 'PATCH', { available: false });
```

### 方式 B：改 `server/seed.js` 重跑（整店重建）

`server/seed.js` 是菜單的**書面來源**（含照片辨識不清的註記）。它第一行就是：

```sql
truncate stores restart identity cascade
```

也就是說 `npm run seed` 會**清掉所有店家、團與訂單**並重建。適合改版菜單、不適合線上已經有人在用的時候。

```bash
npm run migrate   # 先確保 schema 是最新的
npm run seed      # ⚠️ 會清空所有資料
```

菜單資料格式是 `[品名, 價格, 分類, 價格未確認?]`，`sort_order` 由陣列順序自動產生（`index * 10`）。

### 方式 C：直接下 SQL（改單一欄位、或做 API 沒提供的操作）

例如「更新店家名稱／電話」目前沒有 API：

```bash
node --env-file=.env -e "
import('./server/db.js').then(async ({ pool }) => {
  await pool.query(\"update stores set phone = \$1 where name like '%OG CLUB%'\", ['0925-199-522']);
  const { rows } = await pool.query('select id, name, phone from stores');
  console.table(rows);
  await pool.end();
});"
```

---

## 12. 陷阱清單

| 狀況 | 說明 |
|---|---|
| 分類順序不能自訂 | 查詢是 `order by category, sort_order, id`，分類之間依字串碼位排，`sortOrder` **只在同一分類內有效**。要控制分類順序得在名稱前加序號（例如 `1 主食`）。 |
| `GET` 菜單含下架品項 | `available: false` 也會回傳，取用時要自己過濾。 |
| 刪除菜單品項會動到歷史 | `menu_item_id` 被設為 null → `is_custom` 變 true。停售請用 `available: false`。 |
| 兩個 token 只回一次 | 遺失就只能靠 `admin_token` 代操作；`admin_token` 遺失只能查資料庫的 `group_orders.admin_token`。`manageCode` 不同，帶 `X-Admin-Token` 讀團就拿得回來。 |
| 本人改不動已點單的品名與數量 | 品項離開 `pending` 之後 `PATCH` 帶 `name` 或 `qty` 會 400，刪除也會 400。要改請帶管理者以上的憑證，或走撤單。 |
| 已點單的品項仍可改價格 | 刻意的：自填品項常常是結帳才知道多少錢。只有品名與數量被鎖。 |
| 協助管理者關不了攤 | `manager` 對 `PATCH /groups/:joinCode` 會 403，那一支要 `admin`。 |
| 被指派的 admin 刪得掉整攤 | 指派最高管理者＝把「跟我同級」講明了，包含 `DELETE /groups/:joinCode`。 |
| 指派角色只有 admin 做得到 | `manager` 與持 `manageCode` 的人呼叫 `PATCH /orders/:id/role` 一律 403。 |
| 管理代碼給出去收不回來 | 只能整攤重開。要能收回請改用 `PATCH /orders/:orderId/role` 逐一指派。 |
| 同團同名會 409 | `orders (group_order_id, person_name)` 有 unique index，因為彙總是按名字收錢的。 |
| 90 秒內同店同團名同開團者不會開新團 | 回傳既有團並帶 `reused: true`。 |
| 沒有整筆覆蓋的改單 API | 加點用 `POST /orders/:id/items`（只追加），改內容用 `PATCH /order-items/:id`（只動一列）。覆蓋會洗掉已到餐品項的狀態。 |
| 改品項的名稱或價格會脫離菜單 | `menuItemId` 變 null、`isCustom` 變 true。只改 `qty`、`note` 或分單則保留連結。判斷依據是值有沒有變，不是欄位有沒有送。 |
| 分單金額不是欄位 | `payers` / `payable` 每次讀取重算。`shareScope: "all"` 的分母會隨著有人登記或退出而改變，**同一個品項在不同時間讀到的金額可能不同**，這是設計如此。 |
| `sharedWith` 不含自己 | 只列其他人。塞入擁有者自己的 orderId 會被忽略，塞入別團的 orderId 會 400。 |
| 收錢要看 `payable` 不是 `total` | `total` 是「他點了多少」，有分單時兩者不同。拿 `total` 收錢會多收或少收。 |
| 空單是登記，不是垃圾 | `items: []` 的單代表「登記了暱稱還沒點」。別因為它 `counted: false` 就清掉——別人的分單可能指著它。 |
| 品項狀態不需要憑證 | 任何拿到團號的人都能改任何人的品項狀態，且沒有紀錄是誰改的。這是刻意的取捨（見上文），換成陌生人的場景就不成立。 |
| 空單不會自動消失 | 品項刪光後那張單還在，`counted: false`，不計入人數與金額。 |
| `deadlineAt` 一定要帶時區 | `2026-08-08T22:00:00` 會 400，要寫 `+08:00` 或 `Z`。 |
| 批次改狀態會靜默略過 | 一定要檢查回應的 `skipped`。 |
| `:id` 傳非數字會 500 | `/menu-items/abc`、`/stores/abc/menu` 會讓 Postgres 型別轉換失敗（訂單 id 有 UUID 格式檢查，會正確回 404）。 |
| 金額上限 200000 | 超過就 400。上限同時寫在 `server/lib/validate.js`、`client/src/pages/Stores.jsx`、`client/src/components/OrderTab.jsx`，要改必須三處一起改。 |

---

## 13. 端點速查

```
GET    /api/health                          健康檢查

GET    /api/stores                          列出啟用中的店家
POST   /api/stores                          新增店家
DELETE /api/stores/:id                      軟刪除店家（active = false）

GET    /api/stores/:id/menu                 取得菜單（含下架品項）
POST   /api/stores/:id/menu                 新增菜單品項
POST   /api/stores/:id/menu/bulk            一次匯入整份菜單（整批成立或退回）
PATCH  /api/menu-items/:id                  改名／改價／上下架／改分類／改排序
DELETE /api/menu-items/:id                  硬刪除品項（會影響歷史訂單呈現）

POST   /api/groups                          開團 → { joinCode, adminToken,
                                                        manageCode, reused }
GET    /api/groups?storeId=&title=          查同名收單中的團
GET    /api/groups/:joinCode                團 + 菜單 + 所有訂單 + 彙總
                                            （帶憑證才回 group.manageCode）
POST   /api/groups/:joinCode/manage-code    驗證管理代碼
PATCH  /api/groups/:joinCode                關攤／改截止              [最高管理者]
DELETE /api/groups/:joinCode                刪攤（cascade）           [最高管理者]
PATCH  /api/groups/:joinCode/orders/status  批次改品項狀態             [管理者以上]

POST   /api/groups/:joinCode/orders         登記暱稱／下單（items 可為空）
                                                 → { orderId, editToken, total }
PATCH  /api/orders/:orderId                 改暱稱／備註              [本人或管理者以上]
POST   /api/orders/:orderId/items           加點（只追加）            [本人或管理者以上]
DELETE /api/orders/:orderId                 刪整張單                  [本人或管理者以上]
PATCH  /api/orders/:orderId/role           指派角色                  [最高管理者]

PATCH  /api/order-items/:itemId             改數量／品名／價格／備註／分單
                                                                      [本人或管理者以上]
DELETE /api/order-items/:itemId             刪掉其中一樣              [本人或管理者以上]
PATCH  /api/order-items/:itemId/status      改品項狀態          （不需憑證）
PATCH  /api/orders/:orderId/status          整張單一次改狀態    （不需憑證）
```

「管理者以上」＝ `manager` 或 `admin`；「最高管理者」＝ `admin`。角色來自 `X-Manage-Code`、被指派者的 `X-Edit-Token`，或 `X-Admin-Token`（恆為 `admin`），見 §2。

驗證整條流程可跑 `npm run smoke`（需先啟動伺服器；測試資料以 `[smoke]` 開頭並自動清除）。

import { pool, withTransaction } from './db.js';

/**
 * 初始資料。
 *
 * 橙店 OG CLUB 為真實店家（高雄市苓雅區中正二路 165 號，11:00–04:00）。
 * 價格來自公開食記；只查到品名而無公開定價者，第四個欄位標記 true
 * 寫入 price_uncertain，介面會標示「價格待確認」且彙總會註明總額為估算。
 *
 * 其他店家請直接在 app 的「管理店家與菜單」頁面新增。
 */
const STORES = [
  {
    name: '橙店 OG CLUB',
    phone: '0925-199-522',
    note: '高雄市苓雅區中正二路165號・11:00-04:00・日咖夜酒',
    // [品名, 價格, 分類, 價格未確認?]
    menu: [
      // ── 午間餐點 11:00-15:00 ────────────────────────
      ['商業午餐・打拋豬肉飯', 160, '午間餐點'],
      ['商業午餐・紫蘇松露魚排飯', 160, '午間餐點'],
      ['義式小比薩', 150, '午間餐點'],
      ['藤椒香酥雞', 120, '午間餐點'],
      ['橙店牛肉麵', 180, '午間餐點', true],
      ['BBQ 燻雞披薩', 220, '午間餐點', true],
      ['炸物拼盤', 220, '午間餐點', true],

      // ── 晚間料理 17:30-21:00 ────────────────────────
      ['一直流口水雞', 240, '晚間料理'],
      ['蝦滑油炸鬼', 280, '晚間料理'],
      ['山葵鮮蝦球', 380, '晚間料理'],
      ['密室逃脫牛', 450, '晚間料理'],
      ['湘味剁椒魚', 480, '晚間料理'],
      ['冰鎮咕咾肉', 280, '晚間料理', true],
      ['章魚燒蝦餅', 220, '晚間料理', true],
      ['絕代雙腸', 260, '晚間料理', true],
      ['烏鮭蛋炒飯', 240, '晚間料理', true],

      // ── 甜點（全時段）──────────────────────────────
      ['鹽之花乳酪舒芙蕾', 120, '甜點'],
      ['伯爵舒芙蕾乳酪', 120, '甜點'],

      // ── 飲品 ───────────────────────────────────────
      ['西西里美式', 75, '飲品'],
      ['鮮奶紅茶', 45, '飲品'],
      ['拿鐵', 60, '飲品', true],

      // ── 調酒（查到品名，未查到定價）────────────────
      ['良橙桔時', 280, '調酒', true],
      ['紫微醺', 280, '調酒', true],
      ['喝了梅事', 280, '調酒', true],
      ['要你命三千（3L 分享）', 1800, '調酒', true],
    ],
  },
];

await withTransaction(async (client) => {
  await client.query('truncate stores restart identity cascade');

  for (const store of STORES) {
    const { rows } = await client.query(
      'insert into stores (name, phone, note) values ($1, $2, $3) returning id',
      [store.name, store.phone, store.note],
    );
    const storeId = rows[0].id;

    for (const [index, [name, price, category, uncertain]] of store.menu.entries()) {
      await client.query(
        `insert into menu_items (store_id, name, price, category, sort_order, price_uncertain)
         values ($1, $2, $3, $4, $5, $6)`,
        [storeId, name, price, category, index * 10, uncertain === true],
      );
    }
    const uncertainCount = store.menu.filter((m) => m[3] === true).length;
    console.log(
      `✓ ${store.name}（${store.menu.length} 個品項${uncertainCount ? `，其中 ${uncertainCount} 個價格待確認` : ''}）`,
    );
  }
});

console.log('\n測試資料建立完成。');
await pool.end();

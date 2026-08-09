import { badRequest } from './errors.js';

/**
 * 價格信任模型
 *
 * 有 menuItemId → 忽略前端送來的名稱與價格，一律以 menu_items 的資料為準，
 *                 並驗證該品項屬於本團指定的店家且尚未下架。
 * 無 menuItemId → 視為自填品項，採用前端送來的名稱與價格（已於 schema 驗證範圍）。
 *
 * total 永遠在此處重算，前端送來的金額一律丟棄。
 */
export async function resolveItems(client, storeId, items) {
  const menuIds = [
    ...new Set(items.filter((i) => i.menuItemId != null).map((i) => Number(i.menuItemId))),
  ];

  const menuMap = new Map();
  if (menuIds.length > 0) {
    const { rows } = await client.query(
      `select id, store_id, name, price, available, price_uncertain
         from menu_items
        where id = any($1::bigint[])`,
      [menuIds],
    );
    for (const row of rows) menuMap.set(Number(row.id), row);
  }

  const resolved = items.map((item) => {
    // 備註與分單是使用者的意圖，兩種形態都照收——它們不影響價格，
    // 因此不受「菜單品項一律以菜單為準」的限制
    const extras = { note: item.note?.trim() || null, ...normalizeShare(item) };

    if (item.menuItemId == null) {
      return {
        menuItemId: null,
        name: item.name,
        unitPrice: item.unitPrice,
        qty: item.qty,
        priceUncertain: item.priceUncertain === true,
        ...extras,
      };
    }

    const menuItem = menuMap.get(Number(item.menuItemId));
    if (!menuItem) {
      throw badRequest(`品項 #${item.menuItemId} 不存在`);
    }
    if (Number(menuItem.store_id) !== Number(storeId)) {
      throw badRequest(`品項「${menuItem.name}」不屬於本團的店家`);
    }
    if (!menuItem.available) {
      throw badRequest(`品項「${menuItem.name}」已下架，請重新選擇`);
    }

    return {
      menuItemId: Number(menuItem.id),
      name: menuItem.name,
      unitPrice: menuItem.price,
      qty: item.qty,
      // 不確定性由資料庫決定，與價格同源，前端無法偽造
      priceUncertain: menuItem.price_uncertain === true,
      ...extras,
    };
  });

  const total = resolved.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  return { resolved, total };
}

/**
 * 分單設定正規化。
 * 選了「指定的人」卻一個人都沒選，等同只有自己付——保留 custom 會讓
 * split.js 每次都要處理空陣列這個沒有意義的狀態。
 */
export function normalizeShare(item) {
  const scope = item.shareScope ?? 'owner';
  if (scope !== 'custom') return { shareScope: scope, sharedWith: [] };

  const sharedWith = [...new Set(item.sharedWith ?? [])];
  return sharedWith.length > 0
    ? { shareScope: 'custom', sharedWith }
    : { shareScope: 'owner', sharedWith: [] };
}

/**
 * 分單對象必須是同一團裡的人。
 * 不驗的話可以把別團的訂單 id 塞進來，那個人會在自己的團裡看到一筆
 * 來路不明的金額——跨團記帳是真正會造成錯帳的失誤。
 */
export async function assertSharesInGroup(client, groupOrderId, resolved) {
  const ids = [...new Set(resolved.flatMap((item) => item.sharedWith ?? []))];
  if (ids.length === 0) return;

  const { rows } = await client.query(
    'select id from orders where group_order_id = $1 and id = any($2::uuid[])',
    [groupOrderId, ids],
  );
  if (rows.length !== ids.length) {
    throw badRequest('分單對象不在這一團裡，請重新選擇');
  }
}

/**
 * 將解析後的品項寫入 order_items（單次多列 insert），並寫入各自的分單名單。
 * 狀態一律由資料庫預設值給 pending——加點加進來的東西當然還沒跟店家講。
 */
export async function insertOrderItems(client, orderId, resolved) {
  // 只登記暱稱、還沒點東西的單會走到這裡
  if (resolved.length === 0) return [];

  const values = [];
  const params = [];
  resolved.forEach((item, index) => {
    const base = index * 8;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
    );
    params.push(
      orderId,
      item.menuItemId,
      item.name,
      item.unitPrice,
      item.qty,
      item.priceUncertain,
      item.note ?? null,
      item.shareScope ?? 'owner',
    );
  });

  const { rows } = await client.query(
    `insert into order_items
       (order_id, menu_item_id, name, unit_price, qty, price_uncertain, note, share_scope)
     values ${values.join(', ')}
     returning id`,
    params,
  );
  const ids = rows.map((row) => Number(row.id));

  await replaceShares(
    client,
    resolved.map((item, index) => ({ itemId: ids[index], sharedWith: item.sharedWith ?? [] })),
  );

  return ids;
}

/**
 * 覆寫若干品項的分單名單。
 * 先刪後插而非逐筆比對：名單很短（通常一桌不到十人），差異計算不會比較快，
 * 卻多出一堆需要維護的分支。
 */
export async function replaceShares(client, entries) {
  const itemIds = entries.map((entry) => entry.itemId);
  if (itemIds.length === 0) return;

  await client.query('delete from order_item_shares where order_item_id = any($1::bigint[])', [
    itemIds,
  ]);

  const values = [];
  const params = [];
  for (const entry of entries) {
    for (const orderId of entry.sharedWith) {
      params.push(entry.itemId, orderId);
      values.push(`($${params.length - 1}, $${params.length})`);
    }
  }
  if (values.length === 0) return;

  await client.query(
    `insert into order_item_shares (order_item_id, order_id)
     values ${values.join(', ')}
     on conflict do nothing`,
    params,
  );
}

/**
 * 重算並寫回 orders.total。
 *
 * total 是快取，唯一的事實來源是 order_items。任何會影響金額的動作
 * ——加點、改價、刪品項、撤單——都必須呼叫這裡，否則收錢的數字會漂掉。
 * 已撤單的品項不計入。
 */
export async function refreshOrderTotal(client, orderId) {
  const { rows } = await client.query(
    `update orders
        set total = coalesce((
              select sum(unit_price * qty)
                from order_items
               where order_id = $1 and status <> 'cancelled'
            ), 0)
      where id = $1
      returning total`,
    [orderId],
  );
  return rows[0]?.total ?? 0;
}

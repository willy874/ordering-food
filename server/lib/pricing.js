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
    if (item.menuItemId == null) {
      return {
        menuItemId: null,
        name: item.name,
        unitPrice: item.unitPrice,
        qty: item.qty,
        priceUncertain: item.priceUncertain === true,
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
    };
  });

  const total = resolved.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  return { resolved, total };
}

/** 將解析後的品項寫入 order_items（單次多列 insert） */
export async function insertOrderItems(client, orderId, resolved) {
  const values = [];
  const params = [];
  resolved.forEach((item, index) => {
    const base = index * 6;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
    );
    params.push(orderId, item.menuItemId, item.name, item.unitPrice, item.qty, item.priceUncertain);
  });

  await client.query(
    `insert into order_items (order_id, menu_item_id, name, unit_price, qty, price_uncertain)
     values ${values.join(', ')}`,
    params,
  );
}

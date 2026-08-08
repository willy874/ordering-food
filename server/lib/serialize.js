import { ORDER_STATUSES, isCounted } from './orderStatus.js';

/**
 * DB row → API 回應。
 * 注意：edit_token 與 admin_token 絕不出現在任何列表或查詢回應中，
 * 只在建立當下回傳一次給持有者。
 */

export const toStore = (row) => ({
  id: Number(row.id),
  name: row.name,
  phone: row.phone,
  note: row.note,
  active: row.active,
});

export const toMenuItem = (row) => ({
  id: Number(row.id),
  storeId: Number(row.store_id),
  name: row.name,
  price: row.price,
  category: row.category,
  available: row.available,
  sortOrder: row.sort_order,
  priceUncertain: row.price_uncertain === true,
});

export const toOrderItem = (row) => ({
  id: Number(row.id),
  menuItemId: row.menu_item_id == null ? null : Number(row.menu_item_id),
  name: row.name,
  unitPrice: row.unit_price,
  qty: row.qty,
  isCustom: row.is_custom,
  priceUncertain: row.price_uncertain === true,
  subtotal: row.unit_price * row.qty,
});

export const toGroup = (row) => ({
  id: row.id,
  joinCode: row.join_code,
  title: row.title,
  hostName: row.host_name,
  status: row.status,
  deadlineAt: row.deadline_at,
  createdAt: row.created_at,
  store: {
    id: Number(row.store_id),
    name: row.store_name,
    phone: row.store_phone,
  },
});

/**
 * 兩份彙總，這是本系統真正的產出：
 *   byItem   合併所有人的相同品項 → 給店家叫餐
 *   byPerson 每個人的應付金額     → 給收錢的人
 */
export function buildSummary(orders) {
  const itemMap = new Map();

  // 已撤單不進入叫餐清單，也不算錢。這是狀態功能的重點：
  // 撤掉的單若仍計入總額，收錢時會多收。
  const counted = orders.filter((order) => isCounted(order.status));

  for (const order of counted) {
    for (const item of order.items) {
      const key = `${item.isCustom ? 'c' : 'm'}|${item.name}|${item.unitPrice}|${item.priceUncertain ? 'u' : ''}`;
      const existing = itemMap.get(key);
      if (existing) {
        existing.qty += item.qty;
        existing.subtotal += item.subtotal;
      } else {
        itemMap.set(key, {
          name: item.name,
          unitPrice: item.unitPrice,
          qty: item.qty,
          subtotal: item.subtotal,
          isCustom: item.isCustom,
          priceUncertain: item.priceUncertain,
        });
      }
    }
  }

  const byItem = [...itemMap.values()].sort(
    (a, b) => Number(a.isCustom) - Number(b.isCustom) || b.qty - a.qty || a.name.localeCompare(b.name, 'zh-TW'),
  );

  // byPerson 保留所有人（含已撤單），讓介面能顯示「這個人撤掉了」，
  // 但 counted 為 false 者不計入應收金額
  const byPerson = orders.map((order) => ({
    orderId: order.id,
    personName: order.personName,
    total: order.total,
    status: order.status,
    counted: isCounted(order.status),
    itemCount: order.items.reduce((sum, i) => sum + i.qty, 0),
    // 個人金額也要能標示估算，因為收錢是按人結算的
    priceUncertain: order.items.some((i) => i.priceUncertain),
  }));

  const statusCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const order of orders) {
    if (statusCounts[order.status] !== undefined) statusCounts[order.status] += 1;
  }

  // 未確認價格的部分金額，讓彙總能說出「其中 $X 是估的」而不是只給一個模糊警告
  const uncertainSubtotal = byItem
    .filter((i) => i.priceUncertain)
    .reduce((sum, i) => sum + i.subtotal, 0);

  return {
    byItem,
    byPerson,
    grandTotal: counted.reduce((sum, o) => sum + o.total, 0),
    peopleCount: counted.length,
    itemCount: byItem.reduce((sum, i) => sum + i.qty, 0),
    uncertainSubtotal,
    hasUncertainPrice: uncertainSubtotal > 0,
    statusCounts,
    cancelledCount: orders.length - counted.length,
    cancelledTotal: orders
      .filter((o) => !isCounted(o.status))
      .reduce((sum, o) => sum + o.total, 0),
    allServed: counted.length > 0 && counted.every((o) => o.status === 'served'),
  };
}

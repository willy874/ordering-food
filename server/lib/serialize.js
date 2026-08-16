import { ORDER_STATUSES, isCounted, rollupStatus } from './orderStatus.js';
import { applySplits, buildSplitOverview } from './split.js';

/**
 * Drizzle row → API 回應。
 *
 * 欄位名稱兩邊都是 camelCase（對應關係定義在 server/schema.js），
 * 這裡剩下的工作是挑出可以外流的欄位、補上推導值。
 *
 * 注意：editToken 與 adminToken 絕不出現在任何列表或查詢回應中，
 * 只在建立當下回傳一次給持有者。
 */

export const toStore = (row) => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  note: row.note,
  active: row.active,
});

export const toMenuItem = (row) => ({
  id: row.id,
  storeId: row.storeId,
  name: row.name,
  price: row.price,
  category: row.category,
  available: row.available,
  sortOrder: row.sortOrder,
  priceUncertain: row.priceUncertain === true,
});

export const toOrderItem = (row) => ({
  id: row.id,
  menuItemId: row.menuItemId ?? null,
  name: row.name,
  unitPrice: row.unitPrice,
  qty: row.qty,
  isCustom: row.isCustom,
  priceUncertain: row.priceUncertain === true,
  // 這一樣的要求（不要香菜、去冰）。整張單的通則放在 order.note
  note: row.note ?? null,
  // 狀態屬於品項：同一張單裡先點的可能已到餐，後加的還沒點
  status: row.status,
  statusChangedAt: row.statusChangedAt,
  counted: isCounted(row.status),
  subtotal: row.unitPrice * row.qty,
  // 分單設定。實際付款人與金額由 lib/split.js 依全團的人重算後補上
  shareScope: row.shareScope ?? 'owner',
  sharedWith: row.sharedWith ?? [],
});

/**
 * row 是 loadGroup 讀回來的團，store 掛在 row.store 上。
 *
 * manageCode 只在呼叫端已經證明自己是發起人（或已經持有它）時才帶上，
 * 預設不外流——它是一把可以改全團訂單的鑰匙，不該出現在誰都讀得到的快照裡。
 */
export const toGroup = (row, { manageCode = false } = {}) => ({
  id: row.id,
  joinCode: row.joinCode,
  title: row.title,
  hostName: row.hostName,
  status: row.status,
  deadlineAt: row.deadlineAt,
  createdAt: row.createdAt,
  store: {
    id: row.store.id,
    name: row.store.name,
    phone: row.store.phone,
  },
  ...(manageCode ? { manageCode: row.manageCode } : {}),
});

const emptyStatusCounts = () => Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));

function countByStatus(items) {
  const counts = emptyStatusCounts();
  for (const item of items) {
    if (counts[item.status] !== undefined) counts[item.status] += 1;
  }
  return counts;
}

/**
 * 補上由品項推導的欄位。
 * total 只算沒被撤掉的品項——撤掉的仍要留著顯示，但不能跟人收錢。
 */
export function decorateOrder(order) {
  const items = order.items;
  const counted = items.filter((item) => item.counted);

  return {
    ...order,
    items,
    total: counted.reduce((sum, item) => sum + item.subtotal, 0),
    cancelledTotal: items
      .filter((item) => !item.counted)
      .reduce((sum, item) => sum + item.subtotal, 0),
    status: rollupStatus(items),
    statusCounts: countByStatus(items),
    itemCount: counted.reduce((sum, item) => sum + item.qty, 0),
    // 空單（品項都被刪光）不算一個人頭
    counted: counted.length > 0,
    // 留空價格的品項以 0 元計入，不會讓已經確定的金額變成約略值；
    // 只有「猜了一個非 0 金額」的估價品項才算數，跟 buildSummary 的 uncertainSubtotal 同一套判斷。
    priceUncertain: counted.some((item) => item.priceUncertain && item.subtotal !== 0),
  };
}

/**
 * 合併相同品項，供叫餐清單使用。
 * 備註參與比對：「排骨飯 ×2」和「排骨飯（不要香菜）×1」對店家是兩件不同的事，
 * 併成一列唸出去就會做錯。
 */
function mergeItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.isCustom ? 'c' : 'm'}|${item.name}|${item.unitPrice}|${item.priceUncertain ? 'u' : ''}|${item.note ?? ''}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += item.qty;
      existing.subtotal += item.subtotal;
    } else {
      map.set(key, {
        name: item.name,
        unitPrice: item.unitPrice,
        qty: item.qty,
        subtotal: item.subtotal,
        isCustom: item.isCustom,
        priceUncertain: item.priceUncertain,
        note: item.note ?? null,
      });
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      Number(a.isCustom) - Number(b.isCustom) ||
      b.qty - a.qty ||
      a.name.localeCompare(b.name, 'zh-TW'),
  );
}

/**
 * 彙總，這是本系統真正的產出：
 *   byItem        合併所有人的相同品項 → 給店家叫餐
 *   pendingByItem 其中還沒跟店家開口的 → 這一輪要加點的
 *   byPerson      每個人的應付金額     → 給收錢的人
 *   split         分單一覽（誰分了誰的東西）→ 對帳時解釋金額怎麼來的
 *
 * 已撤單的品項不進叫餐清單，也不算錢——留在清單上會多收。
 *
 * 傳入的 orders 必須已經過 applySplits（見 services/groupService.js 的 loadOrders），
 * 每個人的應付金額來自分單計算，不是自己點的東西加總。
 */
export function buildSummary(orders) {
  const allItems = orders.flatMap((order) => order.items);
  const countedItems = allItems.filter((item) => item.counted);

  const byItem = mergeItems(countedItems);
  const pendingByItem = mergeItems(countedItems.filter((item) => item.status === 'pending'));
  const split = buildSplitOverview(orders);

  // byPerson 保留所有人（含整張都撤掉的、只登記還沒點的），讓介面能完整交代，
  // 但 counted 為 false 者不計入人數與應收金額。
  //
  // ownTotal 是「自己點了多少」，payable 是「自己要付多少」——有分單時兩者不同，
  // 收錢看 payable，核對點了什麼看 ownTotal。
  const byPerson = orders.map((order) => ({
    orderId: order.id,
    personName: order.personName,
    ownTotal: order.total,
    payable: order.payable,
    // payable 拆成兩塊：自己點的東西裡自己負擔的、加上別人點的東西分到的
    ownPayable: order.ownPayable,
    sharedIn: order.sharedIn,
    sharedOut: order.sharedOut,
    status: order.status,
    counted: order.payable > 0 || order.counted,
    itemCount: order.itemCount,
    // 個人金額也要能標示估算，因為收錢是按人結算的
    priceUncertain: order.payablePriceUncertain,
  }));

  const uncertainSubtotal = byItem
    .filter((i) => i.priceUncertain)
    .reduce((sum, i) => sum + i.subtotal, 0);

  const cancelledItems = allItems.filter((item) => !item.counted);

  return {
    byItem,
    pendingByItem,
    byPerson,
    split,
    grandTotal: countedItems.reduce((sum, item) => sum + item.subtotal, 0),
    // 要付錢的人。只登記暱稱還沒點、也沒分擔到任何東西的人不算一個人頭
    peopleCount: byPerson.filter((person) => person.counted).length,
    // 登記在這一團裡的所有人，分單時可以選誰的依據
    participantCount: orders.length,
    itemCount: byItem.reduce((sum, i) => sum + i.qty, 0),
    uncertainSubtotal,
    hasUncertainPrice: uncertainSubtotal > 0,
    // 狀態統計以「品項」為單位，因為狀態現在屬於品項
    statusCounts: countByStatus(allItems),
    cancelledCount: cancelledItems.length,
    cancelledTotal: cancelledItems.reduce((sum, item) => sum + item.subtotal, 0),
    allServed:
      countedItems.length > 0 && countedItems.every((item) => item.status === 'served'),
  };
}

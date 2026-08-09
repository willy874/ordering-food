import { badRequest } from './errors.js';

/**
 * 計價 —— 純函式，不碰資料庫。
 *
 * 需要菜單資料的那一步（把 menuItemId 換成真正的名稱與價格）由
 * services/itemService.js 先查好再餵進來，這裡只負責「有了菜單之後怎麼算」。
 */

/**
 * 價格信任模型
 *
 * 有 menuItemId → 忽略前端送來的名稱與價格，一律以 menu_items 的資料為準，
 *                 並驗證該品項屬於本團指定的店家且尚未下架。
 * 無 menuItemId → 視為自填品項，採用前端送來的名稱與價格（已於 schema 驗證範圍）。
 *
 * total 永遠在此處重算，前端送來的金額一律丟棄。
 *
 * @param items    已通過 schema 驗證的品項
 * @param storeId  本團的店家
 * @param menuMap  Map<menuItemId, 菜單列>，由呼叫端從 menuItemRepository 讀來
 */
export function priceItems({ items, storeId, menuMap }) {
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
    if (menuItem.storeId !== Number(storeId)) {
      throw badRequest(`品項「${menuItem.name}」不屬於本團的店家`);
    }
    if (!menuItem.available) {
      throw badRequest(`品項「${menuItem.name}」已下架，請重新選擇`);
    }

    return {
      menuItemId: menuItem.id,
      name: menuItem.name,
      unitPrice: menuItem.price,
      qty: item.qty,
      // 不確定性由資料庫決定，與價格同源，前端無法偽造
      priceUncertain: menuItem.priceUncertain === true,
      ...extras,
    };
  });

  const total = resolved.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  return { resolved, total };
}

/** 這批品項用到的菜單 id，去重後給 repository 一次查完 */
export const menuItemIdsOf = (items) => [
  ...new Set(items.filter((i) => i.menuItemId != null).map((i) => Number(i.menuItemId))),
];

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

import { badRequest } from '../lib/errors.js';
import { menuItemIdsOf, priceItems } from '../lib/pricing.js';
import * as menuItemRepository from '../repositories/menuItemRepository.js';
import * as orderRepository from '../repositories/orderRepository.js';

/**
 * 品項計價與分單驗證。
 *
 * 下單與加點都要走這兩步，因此獨立成一個 service，讓 orderService 兩處共用。
 * 算法本身是純函式（lib/pricing.js），這裡只補上它需要的資料庫查詢。
 */

/** 把送進來的品項換成可以落地的樣子；名稱與價格以菜單為準 */
export async function resolveItems(tx, storeId, items) {
  const menuIds = menuItemIdsOf(items);

  const menuMap = new Map();
  if (menuIds.length > 0) {
    for (const row of await menuItemRepository.findByIds(tx, menuIds)) {
      menuMap.set(row.id, row);
    }
  }

  return priceItems({ items, storeId, menuMap });
}

/**
 * 分單對象必須是同一團裡的人。
 * 不驗的話可以把別團的訂單 id 塞進來，那個人會在自己的團裡看到一筆
 * 來路不明的金額——跨團記帳是真正會造成錯帳的失誤。
 */
export async function assertSharesInGroup(tx, groupOrderId, resolved) {
  const ids = [...new Set(resolved.flatMap((item) => item.sharedWith ?? []))];
  if (ids.length === 0) return;

  const rows = await orderRepository.findIdsInGroup(tx, groupOrderId, ids);
  if (rows.length !== ids.length) {
    throw badRequest('分單對象不在這一團裡，請重新選擇');
  }
}

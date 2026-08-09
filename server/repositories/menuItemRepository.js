import { asc, count, eq, inArray } from 'drizzle-orm';
import { menuItems } from '../schema.js';

/**
 * menu_items 的資料存取。第一個參數一律是 executor（db 或 tx）。
 */

/**
 * 一家店的完整菜單，含已下架的品項——管理頁面要看得到才改得回來，
 * 點餐頁則自行把 available 為 false 的標成不可選。
 *
 * 排序與管理頁面、點餐頁一致，因此集中在這裡，兩邊都用同一個。
 */
export const listByStore = (tx, storeId) =>
  tx
    .select()
    .from(menuItems)
    .where(eq(menuItems.storeId, storeId))
    .orderBy(asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.id));

/** 計價要用的欄位。名稱與價格以這裡讀到的為準，見 lib/pricing.js */
export const findByIds = (tx, ids) =>
  tx
    .select({
      id: menuItems.id,
      storeId: menuItems.storeId,
      name: menuItems.name,
      price: menuItems.price,
      available: menuItems.available,
      priceUncertain: menuItems.priceUncertain,
    })
    .from(menuItems)
    .where(inArray(menuItems.id, ids));

export async function countByStore(tx, storeId) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(menuItems)
    .where(eq(menuItems.storeId, storeId));
  return n;
}

export async function insert(tx, values) {
  const [row] = await tx.insert(menuItems).values(values).returning();
  return row;
}

export const insertMany = (tx, rows) => tx.insert(menuItems).values(rows).returning();

export async function update(tx, id, patch) {
  const [row] = await tx.update(menuItems).set(patch).where(eq(menuItems.id, id)).returning();
  return row ?? null;
}

export async function remove(tx, id) {
  const deleted = await tx
    .delete(menuItems)
    .where(eq(menuItems.id, id))
    .returning({ id: menuItems.id });
  return deleted.length > 0;
}

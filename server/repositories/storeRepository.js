import { and, asc, eq } from 'drizzle-orm';
import { stores } from '../schema.js';

/**
 * stores 的資料存取。
 *
 * 每個函式的第一個參數都是 executor（db 或交易中的 tx），交易內外共用同一份查詢。
 * 這一層只負責讀寫，不丟 HttpError——「找不到」回 null／false，
 * 要不要變成 404 由 service 決定。
 */

export const listActive = (tx) =>
  tx.select().from(stores).where(eq(stores.active, true)).orderBy(asc(stores.name));

export async function findById(tx, id) {
  const [row] = await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, id)).limit(1);
  return row ?? null;
}

export async function findActiveById(tx, id) {
  const [row] = await tx
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, id), eq(stores.active, true)))
    .limit(1);
  return row ?? null;
}

export async function insert(tx, values) {
  const [row] = await tx.insert(stores).values(values).returning();
  return row;
}

/** 部分更新店家資訊。回傳更新後的整列，找不到那一列回 null */
export async function update(tx, id, values) {
  const [row] = await tx.update(stores).set(values).where(eq(stores.id, id)).returning();
  return row ?? null;
}

/** 下架而非刪除：歷史訂單還連著這家店。回傳是否真的有這一列 */
export async function deactivate(tx, id) {
  const updated = await tx
    .update(stores)
    .set({ active: false })
    .where(eq(stores.id, id))
    .returning({ id: stores.id });
  return updated.length > 0;
}

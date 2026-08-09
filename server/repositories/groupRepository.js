import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { groupOrders, orders, stores } from '../schema.js';

/**
 * group_orders 的資料存取。第一個參數一律是 executor（db 或 tx）。
 */

/**
 * 團連同它的店家。回傳的物件欄位與 schema 一致，店家掛在 .store 上。
 * 找不到回 null，要不要變成 404 由 service 決定。
 */
export async function findByJoinCode(tx, joinCode) {
  const rows = await tx
    .select({
      group: groupOrders,
      store: { id: stores.id, name: stores.name, phone: stores.phone },
    })
    .from(groupOrders)
    .innerJoin(stores, eq(stores.id, groupOrders.storeId))
    .where(eq(groupOrders.joinCode, String(joinCode).toUpperCase()))
    .limit(1);

  if (!rows.length) return null;
  return { ...rows[0].group, store: rows[0].store };
}

/**
 * 短時間內同店、同團名、同開團者的團——連點送出或網路重試造成的重複。
 * 條件收得很緊的理由見 services/groupService.js 的 createGroup。
 */
export async function findRecentDuplicate(tx, { storeId, title, hostName, withinSeconds }) {
  const [row] = await tx
    .select({
      id: groupOrders.id,
      joinCode: groupOrders.joinCode,
      adminToken: groupOrders.adminToken,
      manageCode: groupOrders.manageCode,
    })
    .from(groupOrders)
    .where(
      and(
        eq(groupOrders.storeId, storeId),
        eq(groupOrders.title, title),
        eq(groupOrders.hostName, hostName),
        gt(groupOrders.createdAt, sql`now() - make_interval(secs => ${withinSeconds})`),
      ),
    )
    .orderBy(desc(groupOrders.createdAt))
    .limit(1);

  return row ?? null;
}

/** 同店家、仍在收單中的同名團，附上各自的訂單數 */
export const listOpenByStoreAndTitle = (tx, storeId, title, limit = 5) =>
  tx
    .select({
      joinCode: groupOrders.joinCode,
      title: groupOrders.title,
      hostName: groupOrders.hostName,
      createdAt: groupOrders.createdAt,
      deadlineAt: groupOrders.deadlineAt,
      // left join + count(orders.id)：沒有訂單的團也要列出來，count 會是 0
      orderCount: count(orders.id),
    })
    .from(groupOrders)
    .leftJoin(orders, eq(orders.groupOrderId, groupOrders.id))
    .where(
      and(
        eq(groupOrders.storeId, storeId),
        eq(groupOrders.title, title),
        eq(groupOrders.status, 'open'),
      ),
    )
    .groupBy(groupOrders.id)
    .orderBy(desc(groupOrders.createdAt))
    .limit(limit);

/**
 * 現在還收得了單的團——首頁的「進行中」清單。
 *
 * 有效期限的定義與 groupService.assertAcceptingOrders 一致（status open 且未過
 * deadline），差別只在沒設截止時間的團：那種團永遠不會自己過期，掛在首頁上一個月
 * 前的攤只會讓人分不清哪一攤是這幾天的，所以以「建立後 withinHours 小時」為界。
 *
 * 排序用同一個界線由近而遠，最快要截止的排最前面。
 * 一律不外流 adminToken 與 manageCode：這是誰都讀得到的清單。
 */
export const listActive = (tx, { withinHours = 72, limit = 20 } = {}) => {
  const expiresAt = sql`coalesce(${groupOrders.deadlineAt}, ${groupOrders.createdAt} + make_interval(hours => ${withinHours}))`;

  return tx
    .select({
      joinCode: groupOrders.joinCode,
      title: groupOrders.title,
      hostName: groupOrders.hostName,
      createdAt: groupOrders.createdAt,
      deadlineAt: groupOrders.deadlineAt,
      expiresAt: expiresAt.as('expires_at'),
      storeId: stores.id,
      storeName: stores.name,
      // left join + count(orders.id)：還沒有人下單的團也要列出來，count 會是 0
      orderCount: count(orders.id),
    })
    .from(groupOrders)
    .innerJoin(stores, eq(stores.id, groupOrders.storeId))
    .leftJoin(orders, eq(orders.groupOrderId, groupOrders.id))
    .where(and(eq(groupOrders.status, 'open'), gt(expiresAt, sql`now()`)))
    .groupBy(groupOrders.id, stores.id)
    .orderBy(expiresAt)
    .limit(limit);
};

export async function isJoinCodeTaken(tx, joinCode) {
  const rows = await tx
    .select({ id: groupOrders.id })
    .from(groupOrders)
    .where(eq(groupOrders.joinCode, joinCode))
    .limit(1);
  return rows.length > 0;
}

export async function insert(tx, values) {
  const [row] = await tx.insert(groupOrders).values(values).returning({
    id: groupOrders.id,
    joinCode: groupOrders.joinCode,
    adminToken: groupOrders.adminToken,
    manageCode: groupOrders.manageCode,
  });
  return row;
}

export const update = (tx, id, patch) =>
  tx.update(groupOrders).set(patch).where(eq(groupOrders.id, id));

/** orders 與 order_items 皆為 on delete cascade，會一併移除 */
export const remove = (tx, id) => tx.delete(groupOrders).where(eq(groupOrders.id, id));

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { groupOrders, orderItems, orders } from '../schema.js';

/**
 * orders 的資料存取。第一個參數一律是 executor（db 或 tx）。
 */

/**
 * 訂單連同它所屬的團，一次拿齊判斷權限需要的東西。
 * 團的欄位攤平掛在 group 底下，避免與訂單自己的 status 撞名。
 */
export async function findWithGroup(tx, orderId) {
  const rows = await tx
    .select({
      id: orders.id,
      personName: orders.personName,
      editToken: orders.editToken,
      groupOrderId: orders.groupOrderId,
      role: orders.role,
      group: {
        id: groupOrders.id,
        status: groupOrders.status,
        deadlineAt: groupOrders.deadlineAt,
        storeId: groupOrders.storeId,
        adminToken: groupOrders.adminToken,
        manageCode: groupOrders.manageCode,
      },
    })
    .from(orders)
    .innerJoin(groupOrders, eq(groupOrders.id, orders.groupOrderId))
    .where(eq(orders.id, orderId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * 團內所有訂單，連同品項與各自的分單名單，依下單時間排序。
 *
 * 用 Drizzle 的關聯式查詢一次撈完三層，巢狀的 json 聚合由它產生。
 * 沒有品項的單也會讀出來——那是只登記了暱稱還沒點的人，別人要選他分單。
 */
export const listWithItems = (tx, groupOrderId) =>
  tx.query.orders.findMany({
    where: eq(orders.groupOrderId, groupOrderId),
    orderBy: [asc(orders.createdAt)],
    columns: {
      id: true,
      personName: true,
      note: true,
      createdAt: true,
      // 角色是團內公開資訊：大家要知道找誰改單，而且知道團號本來就看得到全團
      role: true,
    },
    with: {
      items: {
        orderBy: [asc(orderItems.id)],
        with: { shares: { columns: { orderId: true } } },
      },
    },
  });

/** 這些訂單 id 裡，真正屬於這一團的有哪些 */
export const findIdsInGroup = (tx, groupOrderId, ids) =>
  tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.groupOrderId, groupOrderId), inArray(orders.id, ids)));

/** 這組 editToken 在本團被指派的角色，沒有這張單則回 null */
export async function findRoleByEditToken(tx, groupOrderId, editToken) {
  const rows = await tx
    .select({ role: orders.role })
    .from(orders)
    .where(and(eq(orders.groupOrderId, groupOrderId), eq(orders.editToken, editToken)));
  return rows.length ? rows[0].role : null;
}

export async function insert(tx, values) {
  const [row] = await tx
    .insert(orders)
    .values(values)
    .returning({ id: orders.id, editToken: orders.editToken });
  return row;
}

export const update = (tx, id, patch) => tx.update(orders).set(patch).where(eq(orders.id, id));

export const remove = (tx, id) => tx.delete(orders).where(eq(orders.id, id));

/**
 * 重算並寫回 orders.total。
 *
 * total 是快取，唯一的事實來源是 order_items。任何會影響金額的動作
 * ——加點、改價、刪品項、撤單——都必須呼叫這裡，否則收錢的數字會漂掉。
 * 已撤單的品項不計入。
 */
export async function refreshTotal(tx, orderId) {
  const subtotalSum = tx
    .select({ value: sql`coalesce(sum(${orderItems.unitPrice} * ${orderItems.qty}), 0)` })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, 'cancelled')));

  const [row] = await tx
    .update(orders)
    .set({ total: sql`(${subtotalSum})` })
    .where(eq(orders.id, orderId))
    .returning({ total: orders.total });

  return row?.total ?? 0;
}

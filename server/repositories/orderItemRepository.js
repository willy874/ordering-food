import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { groupOrders, orderItemShares, orderItems, orders } from '../schema.js';

/**
 * order_items 與它的分單名單（order_item_shares）的資料存取。
 * 兩張表放在一起：分單名單沒有離開品項獨立存在的意義。
 * 第一個參數一律是 executor（db 或 tx）。
 */

/**
 * 單一品項連同它所屬的訂單與團，形狀與 orderRepository.findWithGroup 一致。
 * 找不到回 null。
 */
export async function findWithOrderAndGroup(tx, itemId) {
  const rows = await tx
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      menuItemId: orderItems.menuItemId,
      name: orderItems.name,
      unitPrice: orderItems.unitPrice,
      qty: orderItems.qty,
      isCustom: orderItems.isCustom,
      priceUncertain: orderItems.priceUncertain,
      note: orderItems.note,
      status: orderItems.status,
      statusChangedAt: orderItems.statusChangedAt,
      shareScope: orderItems.shareScope,
      editToken: orders.editToken,
      groupOrderId: orders.groupOrderId,
      group: {
        id: groupOrders.id,
        status: groupOrders.status,
        deadlineAt: groupOrders.deadlineAt,
        storeId: groupOrders.storeId,
        adminToken: groupOrders.adminToken,
        manageCode: groupOrders.manageCode,
      },
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(groupOrders, eq(groupOrders.id, orders.groupOrderId))
    .where(eq(orderItems.id, itemId))
    .limit(1);

  if (!rows.length) return null;

  // 分單名單另外讀。併進上面那個 join 需要一層 lateral 聚合，
  // 換來的只是省一次往返，而呼叫端本來就在交易裡。
  const shares = await tx
    .select({ orderId: orderItemShares.orderId })
    .from(orderItemShares)
    .where(eq(orderItemShares.orderItemId, itemId));

  return { ...rows[0], sharedWith: shares.map((share) => share.orderId) };
}

export async function countByOrder(tx, orderId) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return n;
}

/** 這張單裡狀態不是 status 的品項有幾樣（用來擋「已點單就不能整張刪」） */
export async function countByOrderWithStatusNot(tx, orderId, status) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), ne(orderItems.status, status)));
  return n;
}

/** 整張單的品項狀態，批次推進度時用來挑出可以轉移的 */
export const listStatusesByOrder = (tx, orderId) =>
  tx
    .select({ id: orderItems.id, status: orderItems.status })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

/** 整團的品項狀態；給了 fromStatus 就只取該狀態的 */
export const listStatusesByGroup = (tx, groupOrderId, fromStatus = null) =>
  tx
    .select({ id: orderItems.id, status: orderItems.status, orderId: orderItems.orderId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      fromStatus
        ? and(eq(orders.groupOrderId, groupOrderId), eq(orderItems.status, fromStatus))
        : eq(orders.groupOrderId, groupOrderId),
    );

/**
 * 把計價後的品項寫進一張單（單次多列 insert），並寫入各自的分單名單。
 * 狀態一律由資料庫預設值給 pending——加點加進來的東西當然還沒跟店家講。
 */
export async function createMany(tx, orderId, resolved) {
  // 只登記暱稱、還沒點東西的單會走到這裡
  if (resolved.length === 0) return [];

  const inserted = await tx
    .insert(orderItems)
    .values(
      resolved.map((item) => ({
        orderId,
        menuItemId: item.menuItemId,
        name: item.name,
        unitPrice: item.unitPrice,
        qty: item.qty,
        priceUncertain: item.priceUncertain,
        note: item.note ?? null,
        shareScope: item.shareScope ?? 'owner',
      })),
    )
    .returning({ id: orderItems.id });

  const ids = inserted.map((row) => row.id);

  await replaceShares(
    tx,
    resolved.map((item, index) => ({ itemId: ids[index], sharedWith: item.sharedWith ?? [] })),
  );

  return ids;
}

export async function update(tx, id, patch) {
  const [row] = await tx.update(orderItems).set(patch).where(eq(orderItems.id, id)).returning();
  return row ?? null;
}

export const updateStatus = (tx, ids, status) =>
  tx
    .update(orderItems)
    .set({ status, statusChangedAt: new Date() })
    .where(inArray(orderItems.id, ids));

export const remove = (tx, id) => tx.delete(orderItems).where(eq(orderItems.id, id));

/**
 * 覆寫若干品項的分單名單。
 * 先刪後插而非逐筆比對：名單很短（通常一桌不到十人），差異計算不會比較快，
 * 卻多出一堆需要維護的分支。
 */
export async function replaceShares(tx, entries) {
  const itemIds = entries.map((entry) => entry.itemId);
  if (itemIds.length === 0) return;

  await tx.delete(orderItemShares).where(inArray(orderItemShares.orderItemId, itemIds));

  const rows = entries.flatMap((entry) =>
    entry.sharedWith.map((orderId) => ({ orderItemId: entry.itemId, orderId })),
  );
  if (rows.length === 0) return;

  await tx.insert(orderItemShares).values(rows).onConflictDoNothing();
}

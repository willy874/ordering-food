import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { wrap, notFound, badRequest, unauthorized, conflict, isUniqueViolation } from '../lib/errors.js';
import { resolveItems, insertOrderItems } from '../lib/pricing.js';
import { parse, createOrderSchema, orderStatusSchema } from '../lib/validate.js';
import { canTransition, STATUS_LABELS } from '../lib/orderStatus.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOrder(client, orderId) {
  if (!UUID_RE.test(orderId)) throw notFound('找不到訂單');

  const runner = client ?? { query };
  const { rows } = await runner.query(
    `select o.id, o.person_name, o.edit_token, o.group_order_id, o.status as order_status,
            g.status, g.deadline_at, g.store_id, g.admin_token
       from orders o
       join group_orders g on g.id = o.group_order_id
      where o.id = $1`,
    [orderId],
  );
  if (!rows.length) throw notFound('找不到訂單');
  return rows[0];
}

/**
 * 本人（edit_token）或開團者（admin_token）皆可操作。
 * 前端只用 token 決定按鈕顯示與否，真正的判斷一律在這裡。
 */
function assertCanModify(req, order) {
  const editToken = req.get('X-Edit-Token');
  const adminToken = req.get('X-Admin-Token');

  const isOwner = editToken && editToken === order.edit_token;
  const isHost = adminToken && adminToken === order.admin_token;

  if (!isOwner && !isHost) {
    throw unauthorized('只能修改自己的訂單');
  }
  return { isOwner, isHost };
}

function assertGroupOpen(order) {
  if (order.status !== 'open') throw badRequest('這個團已經關閉');
  if (order.deadline_at && new Date(order.deadline_at) < new Date()) {
    throw badRequest('已超過截止時間');
  }
}

router.put(
  '/orders/:orderId',
  wrap(async (req, res) => {
    const input = parse(createOrderSchema, req.body);

    let result;
    try {
      result = await withTransaction(async (client) => {
        const order = await loadOrder(client, req.params.orderId);
        assertCanModify(req, order);
        assertGroupOpen(order);

        const { resolved, total } = await resolveItems(client, order.store_id, input.items);

        await client.query(
          'update orders set person_name = $1, note = $2, total = $3 where id = $4',
          [input.personName, input.note ?? null, total, order.id],
        );
        await client.query('delete from order_items where order_id = $1', [order.id]);
        await insertOrderItems(client, order.id, resolved);

        return { orderId: order.id, total };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict(`這個團已經有「${input.personName}」了，請換一個名字。`);
      }
      throw err;
    }

    res.json(result);
  }),
);

/**
 * 改單一訂單的狀態。本人或發起人皆可——「我的餐到了」只有本人知道，
 * 「整桌都點完了」則通常由發起人統一標記。
 *
 * 這裡刻意不檢查團是否已結束：結束點餐之後，餐點才正要陸續送達，
 * 狀態仍需要能繼續推進。
 */
router.patch(
  '/orders/:orderId/status',
  wrap(async (req, res) => {
    const input = parse(orderStatusSchema, req.body);
    const order = await loadOrder(null, req.params.orderId);
    assertCanModify(req, order);

    const from = order.order_status;
    const to = input.status;

    if (from === to) {
      return res.json({ orderId: order.id, status: to, changed: false });
    }
    if (!canTransition(from, to)) {
      throw badRequest(`「${STATUS_LABELS[from]}」不能直接改成「${STATUS_LABELS[to]}」`);
    }

    await query('update orders set status = $1, status_changed_at = now() where id = $2', [
      to,
      order.id,
    ]);
    res.json({ orderId: order.id, status: to, changed: true });
  }),
);

router.delete(
  '/orders/:orderId',
  wrap(async (req, res) => {
    const order = await loadOrder(null, req.params.orderId);
    const { isHost } = assertCanModify(req, order);

    // 開團者收拾殘局時可能需要在關團後刪除，本人則受截止時間限制
    if (!isHost) assertGroupOpen(order);

    await query('delete from orders where id = $1', [order.id]);
    res.status(204).end();
  }),
);

export default router;

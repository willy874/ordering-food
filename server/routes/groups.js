import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { wrap, notFound, badRequest, unauthorized, conflict, isUniqueViolation } from '../lib/errors.js';
import { generateUniqueJoinCode } from '../lib/codes.js';
import { resolveItems, insertOrderItems } from '../lib/pricing.js';
import { toGroup, toMenuItem, toOrderItem, buildSummary } from '../lib/serialize.js';
import {
  parse,
  createGroupSchema,
  patchGroupSchema,
  createOrderSchema,
  bulkStatusSchema,
} from '../lib/validate.js';
import { canTransition, STATUS_LABELS } from '../lib/orderStatus.js';

const router = Router();

async function loadGroup(client, joinCode) {
  const { rows } = await (client ?? { query }).query(
    `select g.*, s.name as store_name, s.phone as store_phone
       from group_orders g
       join stores s on s.id = g.store_id
      where g.join_code = $1`,
    [joinCode.toUpperCase()],
  );
  if (!rows.length) throw notFound('找不到這個團，請確認團號');
  return rows[0];
}

/** 讀取團內所有訂單（含品項），依下單時間排序 */
async function loadOrders(client, groupId) {
  const runner = client ?? { query };
  const { rows } = await runner.query(
    `select o.id, o.person_name, o.note, o.total, o.created_at,
            o.status, o.status_changed_at,
            coalesce(
              json_agg(
                json_build_object(
                  'id', i.id, 'menu_item_id', i.menu_item_id, 'name', i.name,
                  'unit_price', i.unit_price, 'qty', i.qty, 'is_custom', i.is_custom,
                  'price_uncertain', i.price_uncertain
                ) order by i.id
              ) filter (where i.id is not null),
              '[]'
            ) as items
       from orders o
       left join order_items i on i.order_id = o.id
      where o.group_order_id = $1
      group by o.id
      order by o.created_at`,
    [groupId],
  );

  return rows.map((row) => ({
    id: row.id,
    personName: row.person_name,
    note: row.note,
    total: row.total,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
    items: row.items.map(toOrderItem),
  }));
}

/** 團是否還能收單 */
function assertAcceptingOrders(group) {
  if (group.status !== 'open') {
    throw badRequest('這個團已經關閉，無法再下單');
  }
  if (group.deadline_at && new Date(group.deadline_at) < new Date()) {
    throw badRequest('已超過截止時間，無法再下單');
  }
}

/** 連點送出、網路重試等造成的短時間重複建立視窗（秒） */
const DEDUPE_WINDOW_SECONDS = 90;

router.post(
  '/groups',
  wrap(async (req, res) => {
    const input = parse(createGroupSchema, req.body);

    const result = await withTransaction(async (client) => {
      const store = await client.query(
        'select 1 from stores where id = $1 and active = true',
        [input.storeId],
      );
      if (!store.rowCount) throw badRequest('找不到店家');

      // 連點兩次或網路重試時，回傳既有的團而非再開一個。
      // 判定條件刻意收得很緊（同店、同團名、同開團者、且在短時間內），
      // 因為每週開一個同名的團是正常行為，不該被誤判為重複。
      const existing = await client.query(
        `select id, join_code, admin_token
           from group_orders
          where store_id = $1 and title = $2 and host_name = $3
            and created_at > now() - ($4 || ' seconds')::interval
          order by created_at desc
          limit 1`,
        [input.storeId, input.title, input.hostName, DEDUPE_WINDOW_SECONDS],
      );
      if (existing.rowCount) {
        return { ...existing.rows[0], reused: true };
      }

      const joinCode = await generateUniqueJoinCode(client);
      const { rows } = await client.query(
        `insert into group_orders (join_code, store_id, title, host_name, deadline_at)
         values ($1, $2, $3, $4, $5)
         returning id, join_code, admin_token`,
        [joinCode, input.storeId, input.title, input.hostName, input.deadlineAt ?? null],
      );
      return { ...rows[0], reused: false };
    });

    // adminToken 只在這裡回傳一次
    res.status(201).json({
      id: result.id,
      joinCode: result.join_code,
      adminToken: result.admin_token,
      reused: result.reused,
    });
  }),
);

/** 查詢同店家、仍在收單中的同名團，讓前端在開團前提醒 */
router.get(
  '/groups',
  wrap(async (req, res) => {
    const { storeId, title } = req.query;
    if (!storeId || !title) throw badRequest('需要 storeId 與 title');

    const { rows } = await query(
      `select g.join_code, g.title, g.host_name, g.created_at, g.deadline_at,
              (select count(*) from orders o where o.group_order_id = g.id) as order_count
         from group_orders g
        where g.store_id = $1 and g.title = $2 and g.status = 'open'
        order by g.created_at desc
        limit 5`,
      [storeId, String(title).trim()],
    );

    res.json(
      rows.map((row) => ({
        joinCode: row.join_code,
        title: row.title,
        hostName: row.host_name,
        createdAt: row.created_at,
        deadlineAt: row.deadline_at,
        orderCount: Number(row.order_count),
      })),
    );
  }),
);

router.get(
  '/groups/:joinCode',
  wrap(async (req, res) => {
    const group = await loadGroup(null, req.params.joinCode);

    const [menu, orders] = await Promise.all([
      query(
        `select * from menu_items
          where store_id = $1
          order by category, sort_order, id`,
        [group.store_id],
      ),
      loadOrders(null, group.id),
    ]);

    res.json({
      group: toGroup(group),
      menu: menu.rows.map(toMenuItem),
      orders,
      summary: buildSummary(orders),
    });
  }),
);

router.patch(
  '/groups/:joinCode',
  wrap(async (req, res) => {
    const input = parse(patchGroupSchema, req.body);
    const group = await loadGroup(null, req.params.joinCode);

    const token = req.get('X-Admin-Token');
    if (!token || token !== group.admin_token) {
      throw unauthorized('只有開團的人可以修改這個團');
    }

    const sets = [];
    const params = [];
    if (input.status !== undefined) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
    }
    if (input.deadlineAt !== undefined) {
      params.push(input.deadlineAt);
      sets.push(`deadline_at = $${params.length}`);
    }
    if (!sets.length) throw badRequest('沒有要更新的欄位');

    params.push(group.id);
    await query(
      `update group_orders set ${sets.join(', ')} where id = $${params.length}`,
      params,
    );

    const updated = await loadGroup(null, req.params.joinCode);
    res.json(toGroup(updated));
  }),
);

/**
 * 批次改狀態，發起人限定。
 * 主要用途：跟店家點完後，把整桌「未點單」一次標成「已點單」。
 * 不合法的轉移會被跳過而非讓整批失敗——批次操作中途卡住比略過更難處理。
 */
router.patch(
  '/groups/:joinCode/orders/status',
  wrap(async (req, res) => {
    const input = parse(bulkStatusSchema, req.body);
    const group = await loadGroup(null, req.params.joinCode);

    const token = req.get('X-Admin-Token');
    if (!token || token !== group.admin_token) {
      throw unauthorized('只有發起的人可以批次修改狀態');
    }

    const { rows: candidates } = await query(
      input.from
        ? 'select id, status from orders where group_order_id = $1 and status = $2'
        : 'select id, status from orders where group_order_id = $1',
      input.from ? [group.id, input.from] : [group.id],
    );

    const movable = candidates.filter((row) => canTransition(row.status, input.to));
    const skipped = candidates.length - movable.length;

    if (movable.length > 0) {
      await query(
        `update orders set status = $1, status_changed_at = now() where id = any($2::uuid[])`,
        [input.to, movable.map((row) => row.id)],
      );
    }

    res.json({
      status: input.to,
      updated: movable.length,
      skipped,
      message: skipped
        ? `${movable.length} 筆已改為「${STATUS_LABELS[input.to]}」，${skipped} 筆因狀態不允許而略過`
        : `${movable.length} 筆已改為「${STATUS_LABELS[input.to]}」`,
    });
  }),
);

router.delete(
  '/groups/:joinCode',
  wrap(async (req, res) => {
    const group = await loadGroup(null, req.params.joinCode);

    const token = req.get('X-Admin-Token');
    if (!token || token !== group.admin_token) {
      throw unauthorized('只有開團的人可以刪除這個團');
    }

    // orders 與 order_items 皆為 on delete cascade，會一併移除
    await query('delete from group_orders where id = $1', [group.id]);
    res.status(204).end();
  }),
);

router.post(
  '/groups/:joinCode/orders',
  wrap(async (req, res) => {
    const input = parse(createOrderSchema, req.body);

    let created;
    try {
      created = await withTransaction(async (client) => {
        const group = await loadGroup(client, req.params.joinCode);
        assertAcceptingOrders(group);

        const { resolved, total } = await resolveItems(client, group.store_id, input.items);

        const { rows } = await client.query(
          `insert into orders (group_order_id, person_name, note, total)
           values ($1, $2, $3, $4)
           returning id, edit_token`,
          [group.id, input.personName, input.note ?? null, total],
        );
        const order = rows[0];

        await insertOrderItems(client, order.id, resolved);
        return { orderId: order.id, editToken: order.edit_token, total };
      });
    } catch (err) {
      // 同團同名：彙總按名字收錢，放行會直接造成錯帳
      if (isUniqueViolation(err)) {
        throw conflict(
          `這個團已經有「${input.personName}」點過了。如果是你要改單，請在原本的裝置上修改；如果是另一個同名的人，請加上區隔（例如「${input.personName}2」）。`,
        );
      }
      throw err;
    }

    // editToken 只在這裡回傳一次
    res.status(201).json(created);
  }),
);

export default router;

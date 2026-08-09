import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { wrap, notFound, badRequest, unauthorized, conflict, isUniqueViolation } from '../lib/errors.js';
import { generateUniqueJoinCode, generateManageCode } from '../lib/codes.js';
import { assertCanManage, assertCanGrant, canSeeManageCode } from '../lib/auth.js';
import {
  resolveItems,
  insertOrderItems,
  refreshOrderTotal,
  assertSharesInGroup,
} from '../lib/pricing.js';
import { toGroup, toMenuItem, toOrderItem, decorateOrder, buildSummary } from '../lib/serialize.js';
import { applySplits } from '../lib/split.js';
import {
  parse,
  createGroupSchema,
  patchGroupSchema,
  createOrderSchema,
  bulkStatusSchema,
  manageCodeSchema,
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

/**
 * 讀取團內所有訂單（含品項與各自的分單名單），依下單時間排序。
 *
 * total 與整張單的狀態都由品項推導（serialize.js 的 decorateOrder），
 * 應付金額則要看完整團才算得出來，因此在這裡一次補上（split.js 的 applySplits）：
 * 「全部平分」的人數是動態的，少讀一張單就會算錯。
 *
 * 沒有品項的單也會被讀出來——那是只登記了暱稱還沒點的人，別人要選他分單。
 */
async function loadOrders(client, groupId) {
  const runner = client ?? { query };
  const { rows } = await runner.query(
    `select o.id, o.person_name, o.note, o.created_at, o.role,
            coalesce(
              json_agg(
                json_build_object(
                  'id', i.id, 'menu_item_id', i.menu_item_id, 'name', i.name,
                  'unit_price', i.unit_price, 'qty', i.qty, 'is_custom', i.is_custom,
                  'price_uncertain', i.price_uncertain, 'note', i.note,
                  'status', i.status, 'status_changed_at', i.status_changed_at,
                  'share_scope', i.share_scope, 'shared_with', s.shared_with
                ) order by i.id
              ) filter (where i.id is not null),
              '[]'
            ) as items
       from orders o
       left join order_items i on i.order_id = o.id
       left join lateral (
         select coalesce(json_agg(sh.order_id order by sh.order_id), '[]') as shared_with
           from order_item_shares sh
          where sh.order_item_id = i.id
       ) s on true
      where o.group_order_id = $1
      group by o.id
      order by o.created_at`,
    [groupId],
  );

  const orders = rows.map((row) =>
    decorateOrder({
      id: row.id,
      personName: row.person_name,
      note: row.note,
      createdAt: row.created_at,
      // 角色是團內公開資訊：大家要知道找誰改單，而且知道團號本來就看得到全團
      role: row.role,
      items: row.items.map(toOrderItem),
    }),
  );

  return applySplits(orders);
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
        `select id, join_code, admin_token, manage_code
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
        `insert into group_orders (join_code, store_id, title, host_name, deadline_at, manage_code)
         values ($1, $2, $3, $4, $5, $6)
         returning id, join_code, admin_token, manage_code`,
        [
          joinCode,
          input.storeId,
          input.title,
          input.hostName,
          input.deadlineAt ?? null,
          generateManageCode(),
        ],
      );
      return { ...rows[0], reused: false };
    });

    // adminToken 只在這裡回傳一次；manageCode 之後仍可由發起人查回來
    res.status(201).json({
      id: result.id,
      joinCode: result.join_code,
      adminToken: result.admin_token,
      manageCode: result.manage_code,
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
      // 帶了正確憑證才看得到管理代碼，否則任何知道團號的人都能自封管理者
      group: toGroup(group, { manageCode: canSeeManageCode(req, group) }),
      menu: menu.rows.map(toMenuItem),
      orders,
      summary: buildSummary(orders),
    });
  }),
);

/**
 * 驗證管理代碼。
 *
 * 前端拿到 200 就把代碼存進 localStorage，之後每次寫入都帶 X-Manage-Code。
 * 這一支本身不發任何憑證——代碼就是憑證，這裡只是讓使用者當場知道打對了沒有，
 * 不然他要等到按下某顆按鈕失敗才發現。
 */
router.post(
  '/groups/:joinCode/manage-code',
  wrap(async (req, res) => {
    const input = parse(manageCodeSchema, req.body);
    const group = await loadGroup(null, req.params.joinCode);

    if (input.manageCode !== group.manage_code) {
      throw unauthorized('管理代碼不正確');
    }

    res.json({ joinCode: group.join_code, manageCode: group.manage_code });
  }),
);

router.patch(
  '/groups/:joinCode',
  wrap(async (req, res) => {
    const input = parse(patchGroupSchema, req.body);
    const group = await loadGroup(null, req.params.joinCode);

    // 關攤與截止時間是最高管理者的事：發起人自己可能正在跟店家講話，
    // 但協助管理者只管訂單，動不了這一攤的節奏
    await assertCanGrant({ query }, req, group, '只有最高管理者可以修改這個團');

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
    // 被指派的最高管理者也能關攤，但不該因此拿到管理代碼——
    // 那是一把收不回來的鑰匙，角色卻是隨時可以撤掉的
    res.json(toGroup(updated, { manageCode: canSeeManageCode(req, updated) }));
  }),
);

/**
 * 批次改狀態，發起人與管理者限定。
 * 主要用途：跟店家點完後，把整桌「未點單」一次標成「已點單」。
 * 不合法的轉移會被跳過而非讓整批失敗——批次操作中途卡住比略過更難處理。
 */
router.patch(
  '/groups/:joinCode/orders/status',
  wrap(async (req, res) => {
    const input = parse(bulkStatusSchema, req.body);
    const group = await loadGroup(null, req.params.joinCode);

    // 「跟店家點完了」通常就是管理者在做的事，所以這裡開放到管理者
    await assertCanManage(
      { query },
      req,
      group,
      '只有管理者以上可以批次修改狀態',
    );

    // 批次的對象是品項：「跟店家點完了」要標的是這一輪還沒點的那些東西，
    // 不是整張單——同一張單裡可能還有上一輪已經到餐的品項
    const result = await withTransaction(async (client) => {
      const { rows: candidates } = await client.query(
        input.from
          ? `select i.id, i.status, i.order_id
               from order_items i
               join orders o on o.id = i.order_id
              where o.group_order_id = $1 and i.status = $2`
          : `select i.id, i.status, i.order_id
               from order_items i
               join orders o on o.id = i.order_id
              where o.group_order_id = $1`,
        input.from ? [group.id, input.from] : [group.id],
      );

      const movable = candidates.filter((row) => canTransition(row.status, input.to));

      if (movable.length > 0) {
        await client.query(
          `update order_items
              set status = $1, status_changed_at = now()
            where id = any($2::bigint[])`,
          [input.to, movable.map((row) => Number(row.id))],
        );

        // 撤單／復原會改變應付金額，受影響的單都要重算
        for (const orderId of new Set(movable.map((row) => row.order_id))) {
          await refreshOrderTotal(client, orderId);
        }
      }

      return { updated: movable.length, skipped: candidates.length - movable.length };
    });

    res.json({
      status: input.to,
      updated: result.updated,
      skipped: result.skipped,
      message: result.skipped
        ? `${result.updated} 樣已改為「${STATUS_LABELS[input.to]}」，${result.skipped} 樣因狀態不允許而略過`
        : `${result.updated} 樣已改為「${STATUS_LABELS[input.to]}」`,
    });
  }),
);

router.delete(
  '/groups/:joinCode',
  wrap(async (req, res) => {
    const group = await loadGroup(null, req.params.joinCode);

    // 刪攤會連同所有人的單一起消失，所以要求最高管理者——
    // 發起人指派出去的人與他同級，代表他刪掉一攤重開是合理的
    await assertCanGrant({ query }, req, group, '只有最高管理者可以刪除這個團');

    // orders 與 order_items 皆為 on delete cascade，會一併移除
    await query('delete from group_orders where id = $1', [group.id]);
    res.status(204).end();
  }),
);

/**
 * 下單，同時也是「登記暱稱」。
 *
 * items 可以是空的：第一次進團先登記，登記出來的就是一張還沒點東西的單。
 * 有了單才有身分——別人選得到你來分單，你自己之後加點也不必再重打名字。
 */
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
        await assertSharesInGroup(client, group.id, resolved);

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
          `這個團已經有人用「${input.personName}」這個暱稱了。如果那就是你，請在原本登記的裝置上繼續點；如果是另一個同名的人，請加上區隔（例如「${input.personName}2」）。`,
        );
      }
      throw err;
    }

    // editToken 只在這裡回傳一次
    res.status(201).json(created);
  }),
);

export default router;

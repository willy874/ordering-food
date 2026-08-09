import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { wrap, notFound, badRequest, unauthorized, conflict, isUniqueViolation } from '../lib/errors.js';
import {
  resolveItems,
  insertOrderItems,
  refreshOrderTotal,
  assertSharesInGroup,
  normalizeShare,
  replaceShares,
} from '../lib/pricing.js';
import {
  parse,
  addOrderItemsSchema,
  patchOrderSchema,
  patchOrderItemSchema,
  patchOrderManagerSchema,
  orderStatusSchema,
  MAX_ITEMS_PER_ORDER,
} from '../lib/validate.js';
import { canTransition, STATUS_LABELS } from '../lib/orderStatus.js';
import { toOrderItem } from '../lib/serialize.js';
import { UUID_RE, resolveActor } from '../lib/auth.js';

const router = Router();

async function loadOrder(client, orderId) {
  if (!UUID_RE.test(orderId)) throw notFound('找不到訂單');

  const runner = client ?? { query };
  const { rows } = await runner.query(
    `select o.id, o.person_name, o.edit_token, o.group_order_id, o.is_manager,
            g.status as group_status, g.deadline_at, g.store_id,
            g.admin_token, g.manage_code
       from orders o
       join group_orders g on g.id = o.group_order_id
      where o.id = $1`,
    [orderId],
  );
  if (!rows.length) throw notFound('找不到訂單');
  return rows[0];
}

/**
 * 載入單一品項連同它所屬的訂單與團，一次拿齊判斷權限需要的東西。
 * 欄位一律寫明：品項與團都有 status，用 i.* 會被團的狀態蓋掉。
 */
async function loadItem(client, itemId) {
  if (!/^\d+$/.test(itemId)) throw notFound('找不到品項');

  const runner = client ?? { query };
  const { rows } = await runner.query(
    `select i.id, i.order_id, i.menu_item_id, i.name, i.unit_price, i.qty,
            i.is_custom, i.price_uncertain, i.note, i.status, i.status_changed_at,
            i.share_scope,
            coalesce(
              (select json_agg(sh.order_id order by sh.order_id)
                 from order_item_shares sh
                where sh.order_item_id = i.id),
              '[]'
            ) as shared_with,
            o.edit_token, o.group_order_id,
            g.status as group_status, g.deadline_at, g.store_id,
            g.admin_token, g.manage_code
       from order_items i
       join orders o on o.id = i.order_id
       join group_orders g on g.id = o.group_order_id
      where i.id = $1`,
    [itemId],
  );
  if (!rows.length) throw notFound('找不到品項');
  return rows[0];
}

/**
 * 本人（edit_token）、管理者（manage_code 或被指派）、發起人（admin_token）皆可操作。
 * 前端只用憑證決定按鈕顯示與否，真正的判斷一律在這裡。見 lib/auth.js。
 */
async function assertCanModify(runner, req, row) {
  const actor = await resolveActor(
    runner ?? { query },
    req,
    { id: row.group_order_id, admin_token: row.admin_token, manage_code: row.manage_code },
    row.edit_token,
  );
  if (!actor.isOwner && !actor.canManage) {
    throw unauthorized('只能修改自己的訂單');
  }
  return actor;
}

/**
 * 團是否還收單。
 *
 * 注意這裡管的只有「加點與改單」。品項狀態不受此限——聚會是一輪一輪點的，
 * 已經跟店家點過的東西，後面還會繼續到餐，狀態必須能一直推進。
 */
function assertGroupOpen(row) {
  if (row.group_status !== 'open') throw badRequest('這個團已經關閉');
  if (row.deadline_at && new Date(row.deadline_at) < new Date()) {
    throw badRequest('已超過截止時間');
  }
}

/**
 * 跟店家點過的東西就不是自己說了算了。
 *
 * 一旦品項離開「未點單」，店家那邊已經記下了品名與數量，本人再改只會讓
 * App 上的清單與店家手上的單對不起來——真正要改的是跟店家重講一次，
 * 所以介面把他導向「另外加點一筆」或「撤單」。
 *
 * 只鎖品名與數量：價格常常是點完才知道的（自填品項留空、標成待確認），
 * 備註與分單也多半在結帳當下才喬，這些擋掉只會把工作全推給發起人。
 *
 * 發起人與管理者不受此限——他們的工作就是收拾殘局。
 */
function assertItemContentEditable(item, actor, input) {
  if (actor.canManage || item.status === 'pending') return;

  const changesName = input.name !== undefined && input.name !== item.name;
  const changesQty = input.qty !== undefined && input.qty !== item.qty;
  if (changesName || changesQty) {
    throw badRequest(
      `「${item.name}」已經是「${STATUS_LABELS[item.status]}」，不能再改品名或數量。` +
        '要多點就另外加一筆，不要了就用撤單。',
    );
  }
}

/** 改名字或備註。品項不受影響。 */
router.patch(
  '/orders/:orderId',
  wrap(async (req, res) => {
    const input = parse(patchOrderSchema, req.body);
    const order = await loadOrder(null, req.params.orderId);
    const actor = await assertCanModify(null, req, order);
    if (!actor.canManage) assertGroupOpen(order);

    const sets = [];
    const params = [];
    if (input.personName !== undefined) {
      params.push(input.personName);
      sets.push(`person_name = $${params.length}`);
    }
    if (input.note !== undefined) {
      params.push(input.note);
      sets.push(`note = $${params.length}`);
    }
    params.push(order.id);

    try {
      await query(`update orders set ${sets.join(', ')} where id = $${params.length}`, params);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict(`這個團已經有「${input.personName}」了，請換一個名字。`);
      }
      throw err;
    }

    res.json({ orderId: order.id });
  }),
);

/**
 * 加點：往既有的單追加品項。
 *
 * 刻意不是「整張單覆蓋」——覆蓋會把已經跟店家點過、甚至已經到餐的品項
 * 連同它們的狀態一起洗掉。已經在單上的東西一律原封不動。
 */
router.post(
  '/orders/:orderId/items',
  wrap(async (req, res) => {
    const input = parse(addOrderItemsSchema, req.body);

    const result = await withTransaction(async (client) => {
      const order = await loadOrder(client, req.params.orderId);
      await assertCanModify(client, req, order);
      // 加點連發起人都受截止時間限制：收單結束就是結束，補點要重新開放
      assertGroupOpen(order);

      const { rows: countRows } = await client.query(
        'select count(*)::int as n from order_items where order_id = $1',
        [order.id],
      );
      if (countRows[0].n + input.items.length > MAX_ITEMS_PER_ORDER) {
        throw badRequest(`一張單最多 ${MAX_ITEMS_PER_ORDER} 個品項，請先整理一下`);
      }

      const { resolved } = await resolveItems(client, order.store_id, input.items);
      await assertSharesInGroup(client, order.group_order_id, resolved);
      const ids = await insertOrderItems(client, order.id, resolved);
      const total = await refreshOrderTotal(client, order.id);

      return { orderId: order.id, addedItemIds: ids, total };
    });

    res.status(201).json(result);
  }),
);

/**
 * 改單一品項的內容（數量、名稱、價格、備註、分單）。
 *
 * 動到名稱或價格就會脫離菜單變成自填品項——菜單品項的名稱與價格
 * 一律以菜單為準，留著連結的話這裡改的值下次就被蓋回去了。備註與分單
 * 不影響價格，所以不會切斷這個連結。
 *
 * 發起人不受截止時間限制：收拾殘局（改錯的價、補漏的備註、把菜挪去分帳）
 * 幾乎都發生在結束點餐之後。
 */
router.patch(
  '/order-items/:itemId',
  wrap(async (req, res) => {
    const input = parse(patchOrderItemSchema, req.body);

    const result = await withTransaction(async (client) => {
      const item = await loadItem(client, req.params.itemId);
      const actor = await assertCanModify(client, req, item);
      if (!actor.canManage) assertGroupOpen(item);
      assertItemContentEditable(item, actor, input);

      // 比對「值有沒有變」而不是「欄位有沒有送」。
      // 編輯介面一次送出整個表單，只改備註或分單時也會帶上原本的品名與價格；
      // 用送出與否判斷的話，那些操作會平白把品項踢出菜單變成自填。
      const touchesContent =
        (input.name !== undefined && input.name !== item.name) ||
        (input.unitPrice !== undefined && input.unitPrice !== item.unit_price) ||
        (input.priceUncertain !== undefined &&
          input.priceUncertain !== (item.price_uncertain === true));

      const touchesShare = input.shareScope !== undefined || input.sharedWith !== undefined;
      const share = normalizeShare({
        shareScope: input.shareScope ?? item.share_scope,
        sharedWith: input.sharedWith ?? item.shared_with,
      });

      const next = {
        name: input.name ?? item.name,
        unitPrice: input.unitPrice ?? item.unit_price,
        priceUncertain: input.priceUncertain ?? item.price_uncertain === true,
        qty: input.qty ?? item.qty,
        note: input.note === undefined ? item.note : input.note || null,
        menuItemId: touchesContent ? null : item.menu_item_id,
      };

      if (touchesShare) {
        await assertSharesInGroup(client, item.group_order_id, [share]);
      }

      const { rows } = await client.query(
        `update order_items
            set name = $1, unit_price = $2, price_uncertain = $3, qty = $4,
                note = $5, share_scope = $6, menu_item_id = $7
          where id = $8
          returning *`,
        [
          next.name,
          next.unitPrice,
          next.priceUncertain,
          next.qty,
          next.note,
          share.shareScope,
          next.menuItemId,
          item.id,
        ],
      );

      if (touchesShare) {
        await replaceShares(client, [{ itemId: Number(item.id), sharedWith: share.sharedWith }]);
      }
      const total = await refreshOrderTotal(client, item.order_id);

      return {
        item: { ...toOrderItem(rows[0]), sharedWith: share.sharedWith },
        total,
      };
    });

    res.json(result);
  }),
);

router.delete(
  '/order-items/:itemId',
  wrap(async (req, res) => {
    await withTransaction(async (client) => {
      const item = await loadItem(client, req.params.itemId);
      const actor = await assertCanModify(client, req, item);
      // 發起人與管理者收拾殘局時可能需要在關團後刪除，本人則受截止時間限制
      if (!actor.canManage) assertGroupOpen(item);

      // 刪掉等於改到不能再改。已經跟店家點過的東西不走這條路，走撤單——
      // 否則「不能改品名數量」只要刪掉重加就繞過了，而且撤單才留得下紀錄。
      if (!actor.canManage && item.status !== 'pending') {
        throw badRequest(
          `「${item.name}」已經是「${STATUS_LABELS[item.status]}」，不能直接刪掉，請改用撤單。`,
        );
      }

      await client.query('delete from order_items where id = $1', [item.id]);
      await refreshOrderTotal(client, item.order_id);
    });

    res.status(204).end();
  }),
);

/**
 * 改單一品項的狀態。
 *
 * 這是全系統唯一不需要憑證的寫入：現場誰看到餐送來誰就能按，
 * 服務生把酒端上桌時，點的人可能正在廁所。拿得到團號就是同一桌的人，
 * 而且能改的只有進度，改不了金額與內容。
 *
 * 也刻意不檢查團是否已結束：結束點餐之後，餐點才正要陸續送達。
 */
router.patch(
  '/order-items/:itemId/status',
  wrap(async (req, res) => {
    const input = parse(orderStatusSchema, req.body);

    const result = await withTransaction(async (client) => {
      const item = await loadItem(client, req.params.itemId);

      const from = item.status;
      const to = input.status;

      if (from === to) return { itemId: Number(item.id), status: to, changed: false };
      if (!canTransition(from, to)) {
        throw badRequest(`「${STATUS_LABELS[from]}」不能直接改成「${STATUS_LABELS[to]}」`);
      }

      await client.query(
        'update order_items set status = $1, status_changed_at = now() where id = $2',
        [to, item.id],
      );
      // 撤單與復原都會改變應付金額
      const total = await refreshOrderTotal(client, item.order_id);

      return { itemId: Number(item.id), status: to, changed: true, total };
    });

    res.json(result);
  }),
);

/**
 * 把整張單的品項一次推到同一個狀態，例如「我這單整個撤掉」。
 * 與單一品項同樣不需憑證；轉移不合法的品項略過而非整批失敗。
 */
router.patch(
  '/orders/:orderId/status',
  wrap(async (req, res) => {
    const input = parse(orderStatusSchema, req.body);

    const result = await withTransaction(async (client) => {
      const order = await loadOrder(client, req.params.orderId);

      const { rows } = await client.query(
        'select id, status from order_items where order_id = $1',
        [order.id],
      );

      const movable = rows.filter((row) => canTransition(row.status, input.status));
      if (movable.length > 0) {
        await client.query(
          `update order_items
              set status = $1, status_changed_at = now()
            where id = any($2::bigint[])`,
          [input.status, movable.map((row) => Number(row.id))],
        );
      }
      const total = await refreshOrderTotal(client, order.id);

      return {
        orderId: order.id,
        status: input.status,
        updated: movable.length,
        skipped: rows.length - movable.length,
        total,
      };
    });

    res.json(result);
  }),
);

router.delete(
  '/orders/:orderId',
  wrap(async (req, res) => {
    const order = await loadOrder(null, req.params.orderId);
    const actor = await assertCanModify(null, req, order);

    // 發起人與管理者收拾殘局時可能需要在關團後刪除，本人則受截止時間限制
    if (!actor.canManage) assertGroupOpen(order);

    // 同刪單一品項：已經跟店家點過的東西不能被本人整張帶走，
    // 否則刪掉整張再重新登記就繞過了「點單後不能改」。
    if (!actor.canManage) {
      const { rows } = await query(
        `select count(*)::int as n from order_items
          where order_id = $1 and status <> 'pending'`,
        [order.id],
      );
      if (rows[0].n > 0) {
        throw badRequest(
          `單裡有 ${rows[0].n} 樣已經跟店家點過了，不能整張刪掉。要取消請逐項撤單。`,
        );
      }
    }

    await query('delete from orders where id = $1', [order.id]);
    res.status(204).end();
  }),
);

/**
 * 指派／取消管理者，發起人限定。
 *
 * 被指派的人用他自己原本的 edit_token 就有管理權，不必再收一次代碼——
 * 現場把手機遞來遞去輸代碼比講一句「你幫我管一下」麻煩得多。
 *
 * 刻意不讓管理者再指派管理者：權力只從發起人流出，收得回來。
 */
router.patch(
  '/orders/:orderId/manager',
  wrap(async (req, res) => {
    const input = parse(patchOrderManagerSchema, req.body);
    const order = await loadOrder(null, req.params.orderId);

    const token = req.get('X-Admin-Token');
    if (!token || token !== order.admin_token) {
      throw unauthorized('只有發起的人可以指派管理者');
    }

    await query('update orders set is_manager = $1 where id = $2', [input.isManager, order.id]);
    res.json({ orderId: order.id, personName: order.person_name, isManager: input.isManager });
  }),
);

export default router;

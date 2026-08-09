import { db, withTransaction } from '../db.js';
import { badRequest, conflict, isUniqueViolation, notFound, unauthorized } from '../lib/errors.js';
import { canTransition, STATUS_LABELS } from '../lib/orderStatus.js';
import { normalizeShare } from '../lib/pricing.js';
import { toOrderItem } from '../lib/serialize.js';
import { MAX_ITEMS_PER_ORDER } from '../lib/validate.js';
import * as orderItemRepository from '../repositories/orderItemRepository.js';
import * as orderRepository from '../repositories/orderRepository.js';
import { assertSharesInGroup, resolveItems } from './itemService.js';
import { assertAcceptingOrders, getByJoinCode } from './groupService.js';
import { assertCanGrant, resolveActor } from './permissionService.js';

/** 訂單連同它所屬的團，找不到就 404 */
async function requireOrder(tx, orderId) {
  const order = await orderRepository.findWithGroup(tx, orderId);
  if (!order) throw notFound('找不到訂單');
  return order;
}

/** 品項連同它所屬的訂單與團，形狀與 requireOrder 一致 */
async function requireItem(tx, itemId) {
  const item = await orderItemRepository.findWithOrderAndGroup(tx, itemId);
  if (!item) throw notFound('找不到品項');
  return item;
}

/**
 * 本人（editToken）、管理者（manageCode 或被指派）、發起人（adminToken）皆可操作。
 * 前端只用憑證決定按鈕顯示與否，真正的判斷一律在這裡。見 services/permissionService.js。
 */
async function assertCanModify(tx, credentials, row) {
  const actor = await resolveActor(tx, credentials, row.group, row.editToken);
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
  if (row.group.status !== 'open') throw badRequest('這個團已經關閉');
  if (row.group.deadlineAt && new Date(row.group.deadlineAt) < new Date()) {
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

/**
 * 下單，同時也是「登記暱稱」。
 *
 * items 可以是空的：第一次進團先登記，登記出來的就是一張還沒點東西的單。
 * 有了單才有身分——別人選得到你來分單，你自己之後加點也不必再重打名字。
 */
export async function createOrder(joinCode, input) {
  try {
    return await withTransaction(async (tx) => {
      const group = await getByJoinCode(tx, joinCode);
      assertAcceptingOrders(group);

      const { resolved, total } = await resolveItems(tx, group.storeId, input.items);
      await assertSharesInGroup(tx, group.id, resolved);

      const order = await orderRepository.insert(tx, {
        groupOrderId: group.id,
        personName: input.personName,
        note: input.note ?? null,
        total,
      });

      await orderItemRepository.createMany(tx, order.id, resolved);
      // editToken 只在這裡回傳一次
      return { orderId: order.id, editToken: order.editToken, total };
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
}

/** 改名字或備註。品項不受影響。 */
export async function updateOrder(orderId, input, credentials) {
  const order = await requireOrder(db, orderId);
  const actor = await assertCanModify(db, credentials, order);
  if (!actor.canManage) assertGroupOpen(order);

  const patch = {};
  if (input.personName !== undefined) patch.personName = input.personName;
  if (input.note !== undefined) patch.note = input.note;

  try {
    await orderRepository.update(db, order.id, patch);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`這個團已經有「${input.personName}」了，請換一個名字。`);
    }
    throw err;
  }

  return { orderId: order.id };
}

/**
 * 加點：往既有的單追加品項。
 *
 * 刻意不是「整張單覆蓋」——覆蓋會把已經跟店家點過、甚至已經到餐的品項
 * 連同它們的狀態一起洗掉。已經在單上的東西一律原封不動。
 */
export function addItems(orderId, input, credentials) {
  return withTransaction(async (tx) => {
    const order = await requireOrder(tx, orderId);
    await assertCanModify(tx, credentials, order);
    // 加點連發起人都受截止時間限制：收單結束就是結束，補點要重新開放
    assertGroupOpen(order);

    const existing = await orderItemRepository.countByOrder(tx, order.id);
    if (existing + input.items.length > MAX_ITEMS_PER_ORDER) {
      throw badRequest(`一張單最多 ${MAX_ITEMS_PER_ORDER} 個品項，請先整理一下`);
    }

    const { resolved } = await resolveItems(tx, order.group.storeId, input.items);
    await assertSharesInGroup(tx, order.groupOrderId, resolved);
    const addedItemIds = await orderItemRepository.createMany(tx, order.id, resolved);
    const total = await orderRepository.refreshTotal(tx, order.id);

    return { orderId: order.id, addedItemIds, total };
  });
}

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
export function updateItem(itemId, input, credentials) {
  return withTransaction(async (tx) => {
    const item = await requireItem(tx, itemId);
    const actor = await assertCanModify(tx, credentials, item);
    if (!actor.canManage) assertGroupOpen(item);
    assertItemContentEditable(item, actor, input);

    // 比對「值有沒有變」而不是「欄位有沒有送」。
    // 編輯介面一次送出整個表單，只改備註或分單時也會帶上原本的品名與價格；
    // 用送出與否判斷的話，那些操作會平白把品項踢出菜單變成自填。
    const touchesContent =
      (input.name !== undefined && input.name !== item.name) ||
      (input.unitPrice !== undefined && input.unitPrice !== item.unitPrice) ||
      (input.priceUncertain !== undefined &&
        input.priceUncertain !== (item.priceUncertain === true));

    const touchesShare = input.shareScope !== undefined || input.sharedWith !== undefined;
    const share = normalizeShare({
      shareScope: input.shareScope ?? item.shareScope,
      sharedWith: input.sharedWith ?? item.sharedWith,
    });

    if (touchesShare) {
      await assertSharesInGroup(tx, item.groupOrderId, [share]);
    }

    const updated = await orderItemRepository.update(tx, item.id, {
      name: input.name ?? item.name,
      unitPrice: input.unitPrice ?? item.unitPrice,
      priceUncertain: input.priceUncertain ?? item.priceUncertain === true,
      qty: input.qty ?? item.qty,
      note: input.note === undefined ? item.note : input.note || null,
      shareScope: share.shareScope,
      menuItemId: touchesContent ? null : item.menuItemId,
    });

    if (touchesShare) {
      await orderItemRepository.replaceShares(tx, [
        { itemId: item.id, sharedWith: share.sharedWith },
      ]);
    }
    const total = await orderRepository.refreshTotal(tx, item.orderId);

    return {
      item: { ...toOrderItem(updated), sharedWith: share.sharedWith },
      total,
    };
  });
}

export function deleteItem(itemId, credentials) {
  return withTransaction(async (tx) => {
    const item = await requireItem(tx, itemId);
    const actor = await assertCanModify(tx, credentials, item);
    // 發起人與管理者收拾殘局時可能需要在關團後刪除，本人則受截止時間限制
    if (!actor.canManage) assertGroupOpen(item);

    // 刪掉等於改到不能再改。已經跟店家點過的東西不走這條路，走撤單——
    // 否則「不能改品名數量」只要刪掉重加就繞過了，而且撤單才留得下紀錄。
    if (!actor.canManage && item.status !== 'pending') {
      throw badRequest(
        `「${item.name}」已經是「${STATUS_LABELS[item.status]}」，不能直接刪掉，請改用撤單。`,
      );
    }

    await orderItemRepository.remove(tx, item.id);
    await orderRepository.refreshTotal(tx, item.orderId);
  });
}

/**
 * 改單一品項的狀態。
 *
 * 這是全系統唯一不需要憑證的寫入：現場誰看到餐送來誰就能按，
 * 服務生把酒端上桌時，點的人可能正在廁所。拿得到團號就是同一桌的人，
 * 而且能改的只有進度，改不了金額與內容。
 *
 * 也刻意不檢查團是否已結束：結束點餐之後，餐點才正要陸續送達。
 */
export function updateItemStatus(itemId, input) {
  return withTransaction(async (tx) => {
    const item = await requireItem(tx, itemId);

    const from = item.status;
    const to = input.status;

    if (from === to) return { itemId: item.id, status: to, changed: false };
    if (!canTransition(from, to)) {
      throw badRequest(`「${STATUS_LABELS[from]}」不能直接改成「${STATUS_LABELS[to]}」`);
    }

    await orderItemRepository.updateStatus(tx, [item.id], to);
    // 撤單與復原都會改變應付金額
    const total = await orderRepository.refreshTotal(tx, item.orderId);

    return { itemId: item.id, status: to, changed: true, total };
  });
}

/**
 * 把整張單的品項一次推到同一個狀態，例如「我這單整個撤掉」。
 * 與單一品項同樣不需憑證；轉移不合法的品項略過而非整批失敗。
 */
export function updateOrderStatus(orderId, input) {
  return withTransaction(async (tx) => {
    const order = await requireOrder(tx, orderId);

    const rows = await orderItemRepository.listStatusesByOrder(tx, order.id);
    const movable = rows.filter((row) => canTransition(row.status, input.status));
    if (movable.length > 0) {
      await orderItemRepository.updateStatus(
        tx,
        movable.map((row) => row.id),
        input.status,
      );
    }
    const total = await orderRepository.refreshTotal(tx, order.id);

    return {
      orderId: order.id,
      status: input.status,
      updated: movable.length,
      skipped: rows.length - movable.length,
      total,
    };
  });
}

export async function deleteOrder(orderId, credentials) {
  const order = await requireOrder(db, orderId);
  const actor = await assertCanModify(db, credentials, order);

  // 發起人與管理者收拾殘局時可能需要在關團後刪除，本人則受截止時間限制
  if (!actor.canManage) assertGroupOpen(order);

  // 同刪單一品項：已經跟店家點過的東西不能被本人整張帶走，
  // 否則刪掉整張再重新登記就繞過了「點單後不能改」。
  if (!actor.canManage) {
    const n = await orderItemRepository.countByOrderWithStatusNot(db, order.id, 'pending');
    if (n > 0) {
      throw badRequest(`單裡有 ${n} 樣已經跟店家點過了，不能整張刪掉。要取消請逐項撤單。`);
    }
  }

  await orderRepository.remove(db, order.id);
}

/**
 * 指派角色，最高管理者限定。
 *
 * 被指派的人用他自己原本的 editToken 就有權限，不必再收一次代碼——
 * 現場把手機遞來遞去輸代碼比講一句「你幫我管一下」麻煩得多。
 *
 * 最高管理者可以再指派最高管理者，這是刻意的：發起人不會整晚盯著手機等別人
 * 來要權限。代價是他也可以把別人降回參與者，但發起人手上的 adminToken
 * 不在這張表裡，永遠收得回來。
 *
 * 持管理代碼的人只是協助管理者，指派不了任何人——代碼給出去收不回來，
 * 能拿它再生出更多管理者的話就再也收束不了了。
 */
export async function assignRole(orderId, input, credentials) {
  const order = await requireOrder(db, orderId);

  await assertCanGrant(db, credentials, order.group, '只有最高管理者可以指派權限');

  await orderRepository.update(db, order.id, { role: input.role });
  return { orderId: order.id, personName: order.personName, role: input.role };
}

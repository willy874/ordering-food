import { db, withTransaction } from '../db.js';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { generateJoinCode, generateManageCode } from '../lib/codes.js';
import { canSeeManageCode } from '../lib/roles.js';
import { canTransition, STATUS_LABELS } from '../lib/orderStatus.js';
import { buildSummary, decorateOrder, toGroup, toMenuItem, toOrderItem } from '../lib/serialize.js';
import { applySplits } from '../lib/split.js';
import * as groupRepository from '../repositories/groupRepository.js';
import * as menuItemRepository from '../repositories/menuItemRepository.js';
import * as orderItemRepository from '../repositories/orderItemRepository.js';
import * as orderRepository from '../repositories/orderRepository.js';
import * as storeRepository from '../repositories/storeRepository.js';
import { assertCanGrant, assertCanManage } from './permissionService.js';

/** 連點送出、網路重試等造成的短時間重複建立視窗（秒） */
const DEDUPE_WINDOW_SECONDS = 90;

/**
 * 沒設截止時間的團，開多久之後就不再列進「進行中」（小時）。
 * 那種團永遠不會自己過期，總得有個界線，否則首頁會被沒人記得關的舊攤塞滿。
 */
const ACTIVE_WITHOUT_DEADLINE_HOURS = 72;

/**
 * 團號在 31 個字元的字母表下有約 8.9 億種組合，實務上幾乎不會碰撞，
 * 但仍重試數次以防萬一。
 */
async function reserveJoinCode(tx, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const code = generateJoinCode();
    if (!(await groupRepository.isJoinCodeTaken(tx, code))) return code;
  }
  throw new Error('無法產生不重複的團號');
}

/** 團連同店家，找不到就 404。orderService 也用這一支。 */
export async function getByJoinCode(tx, joinCode) {
  const group = await groupRepository.findByJoinCode(tx, joinCode);
  if (!group) throw notFound('找不到這個團，請確認團號');
  return group;
}

/** 團是否還能收單 */
export function assertAcceptingOrders(group) {
  if (group.status !== 'open') {
    throw badRequest('這個團已經關閉，無法再下單');
  }
  if (group.deadlineAt && new Date(group.deadlineAt) < new Date()) {
    throw badRequest('已超過截止時間，無法再下單');
  }
}

/**
 * 讀取團內所有訂單（含品項與各自的分單名單）。
 *
 * total 與整張單的狀態都由品項推導（serialize.js 的 decorateOrder），
 * 應付金額則要看完整團才算得出來，因此在這裡一次補上（split.js 的 applySplits）：
 * 「全部平分」的人數是動態的，少讀一張單就會算錯。
 */
async function loadOrders(tx, groupId) {
  const rows = await orderRepository.listWithItems(tx, groupId);

  const decorated = rows.map((row) =>
    decorateOrder({
      id: row.id,
      personName: row.personName,
      note: row.note,
      createdAt: row.createdAt,
      role: row.role,
      items: row.items.map((item) =>
        toOrderItem({ ...item, sharedWith: item.shares.map((share) => share.orderId) }),
      ),
    }),
  );

  return applySplits(decorated);
}

export async function createGroup(input) {
  const result = await withTransaction(async (tx) => {
    if (!(await storeRepository.findActiveById(tx, input.storeId))) {
      throw badRequest('找不到店家');
    }

    // 連點兩次或網路重試時，回傳既有的團而非再開一個。
    // 判定條件刻意收得很緊（同店、同團名、同開團者、且在短時間內），
    // 因為每週開一個同名的團是正常行為，不該被誤判為重複。
    const existing = await groupRepository.findRecentDuplicate(tx, {
      storeId: input.storeId,
      title: input.title,
      hostName: input.hostName,
      withinSeconds: DEDUPE_WINDOW_SECONDS,
    });
    if (existing) return { ...existing, reused: true };

    const created = await groupRepository.insert(tx, {
      joinCode: await reserveJoinCode(tx),
      storeId: input.storeId,
      title: input.title,
      hostName: input.hostName,
      deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
      manageCode: generateManageCode(),
    });
    return { ...created, reused: false };
  });

  // adminToken 只在這裡回傳一次；manageCode 之後仍可由發起人查回來
  return {
    id: result.id,
    joinCode: result.joinCode,
    adminToken: result.adminToken,
    manageCode: result.manageCode,
    reused: result.reused,
  };
}

/**
 * 首頁的「進行中」清單：現在還收得了單的所有團。
 *
 * 這一支不需要憑證，也就是說任何打得開網址的人都看得到團號並加入。
 * 這與菜單 CRUD 不設防是同一個取捨（內部工具、彼此信任）——沒有這份清單，
 * 沒收到連結的人就只能去問別人團號。
 */
export async function listActive() {
  const rows = await groupRepository.listActive(db, { withinHours: ACTIVE_WITHOUT_DEADLINE_HOURS });

  // expiresAt 是 SQL 運算式算出來的，沒有欄位型別可對應，驅動原樣回字串
  //（`2026-08-10 08:11:02+00`）。這裡補成跟其他時間欄位一樣的 ISO。
  return rows.map((row) => ({ ...row, expiresAt: new Date(row.expiresAt).toISOString() }));
}

/** 同店家、仍在收單中的同名團，讓前端在開團前提醒 */
export function findOpenDuplicates(storeId, title) {
  return groupRepository.listOpenByStoreAndTitle(db, storeId, String(title).trim());
}

/** 清單頁的一整份快照：團、菜單、所有人的訂單、彙總 */
export async function getSnapshot(joinCode, credentials) {
  const group = await getByJoinCode(db, joinCode);

  const [menu, orders] = await Promise.all([
    menuItemRepository.listByStore(db, group.storeId),
    loadOrders(db, group.id),
  ]);

  return {
    // 帶了正確憑證才看得到管理代碼，否則任何知道團號的人都能自封管理者
    group: toGroup(group, { manageCode: canSeeManageCode(credentials, group) }),
    menu: menu.map(toMenuItem),
    orders,
    summary: buildSummary(orders),
  };
}

/**
 * 驗證管理代碼。
 *
 * 前端拿到 200 就把代碼存進 localStorage，之後每次寫入都帶 X-Manage-Code。
 * 這一支本身不發任何憑證——代碼就是憑證，這裡只是讓使用者當場知道打對了沒有，
 * 不然他要等到按下某顆按鈕失敗才發現。
 */
export async function verifyManageCode(joinCode, input) {
  const group = await getByJoinCode(db, joinCode);
  if (input.manageCode !== group.manageCode) throw unauthorized('管理代碼不正確');

  return { joinCode: group.joinCode, manageCode: group.manageCode };
}

export async function updateGroup(joinCode, input, credentials) {
  const group = await getByJoinCode(db, joinCode);

  // 關攤與截止時間是最高管理者的事：發起人自己可能正在跟店家講話，
  // 但協助管理者只管訂單，動不了這一攤的節奏
  await assertCanGrant(db, credentials, group, '只有最高管理者可以修改這個團');

  const patch = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.deadlineAt !== undefined) {
    patch.deadlineAt = input.deadlineAt ? new Date(input.deadlineAt) : null;
  }
  if (Object.keys(patch).length === 0) throw badRequest('沒有要更新的欄位');

  await groupRepository.update(db, group.id, patch);

  const updated = await getByJoinCode(db, joinCode);
  // 被指派的最高管理者也能關攤，但不該因此拿到管理代碼——
  // 那是一把收不回來的鑰匙，角色卻是隨時可以撤掉的
  return toGroup(updated, { manageCode: canSeeManageCode(credentials, updated) });
}

/**
 * 批次改狀態。
 * 主要用途：跟店家點完後，把整桌「未點單」一次標成「已點單」。
 * 不合法的轉移會被跳過而非讓整批失敗——批次操作中途卡住比略過更難處理。
 */
export async function bulkUpdateItemStatus(joinCode, input, credentials) {
  const group = await getByJoinCode(db, joinCode);

  // 「跟店家點完了」通常就是管理者在做的事，所以這裡開放到管理者
  await assertCanManage(db, credentials, group, '只有管理者以上可以批次修改狀態');

  // 批次的對象是品項：「跟店家點完了」要標的是這一輪還沒點的那些東西，
  // 不是整張單——同一張單裡可能還有上一輪已經到餐的品項
  const { updated, skipped } = await withTransaction(async (tx) => {
    const candidates = await orderItemRepository.listStatusesByGroup(tx, group.id, input.from);
    const movable = candidates.filter((row) => canTransition(row.status, input.to));

    if (movable.length > 0) {
      await orderItemRepository.updateStatus(
        tx,
        movable.map((row) => row.id),
        input.to,
      );

      // 撤單／復原會改變應付金額，受影響的單都要重算
      for (const orderId of new Set(movable.map((row) => row.orderId))) {
        await orderRepository.refreshTotal(tx, orderId);
      }
    }

    return { updated: movable.length, skipped: candidates.length - movable.length };
  });

  return {
    status: input.to,
    updated,
    skipped,
    message: skipped
      ? `${updated} 樣已改為「${STATUS_LABELS[input.to]}」，${skipped} 樣因狀態不允許而略過`
      : `${updated} 樣已改為「${STATUS_LABELS[input.to]}」`,
  };
}

export async function deleteGroup(joinCode, credentials) {
  const group = await getByJoinCode(db, joinCode);

  // 刪攤會連同所有人的單一起消失，所以要求最高管理者——
  // 發起人指派出去的人與他同級，代表他刪掉一攤重開是合理的
  await assertCanGrant(db, credentials, group, '只有最高管理者可以刪除這個團');

  await groupRepository.remove(db, group.id);
}

import { unauthorized } from './errors.js';

/**
 * 身分判定。
 *
 * 沒有帳號系統，一切都是憑證比對。三個角色，權力由小到大：
 *
 *   participant  參與者      只動得了自己那張單，且已點單的品項改不了品名與數量
 *   manager      協助管理者  可以改清單上所有人的所有品項、代刪、批次推進度，
 *                            不受截止時間與品項狀態限制
 *   admin        最高管理者  再加上「指派別人的角色」與關攤／改截止時間
 *
 * 憑證與角色的對應：
 *
 *   X-Edit-Token   那張單的 orders.role（預設 participant）
 *   X-Manage-Code  manager。不必事先登記，所以「幫忙結帳但沒點東西」的人也能用；
 *                  刻意不含指派權——代碼給出去收不回來，能再生管理者就收束不了了
 *   X-Admin-Token  admin。發起人恆為最高管理者，且是唯一刪得掉整攤的人
 *
 * 前端只用這些憑證決定按鈕顯不顯示，真正的把關一律在這裡。
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ROLES = ['participant', 'manager', 'admin'];

export const ROLE_LABELS = {
  participant: '參與者',
  manager: '協助管理者',
  admin: '最高管理者',
};

/** 角色高低。多個憑證同時存在時取最高的那個。 */
const RANK = { participant: 0, manager: 1, admin: 2 };

const header = (req, name) => (req.get(name) || '').trim();

/**
 * 判斷這次請求在這個團裡是什麼身分。
 *
 * @param runner          pg client 或 { query }
 * @param req             Express request，憑證從 header 取
 * @param group           { id, admin_token, manage_code }
 * @param ownerEditToken  被操作的那張單的 edit_token；沒有目標訂單時省略
 */
export async function resolveActor(runner, req, group, ownerEditToken = null) {
  const editToken = header(req, 'X-Edit-Token');
  const adminToken = header(req, 'X-Admin-Token');
  const manageCode = header(req, 'X-Manage-Code').toUpperCase();

  const isHost = Boolean(adminToken) && adminToken === group.admin_token;
  const isOwner = Boolean(editToken) && Boolean(ownerEditToken) && editToken === ownerEditToken;

  let role = 'participant';
  if (manageCode && manageCode === group.manage_code) role = 'manager';

  // 被指派的角色：用他自己的 edit_token 行使。
  // 先擋掉格式不對的字串，否則 uuid 轉型會讓查詢直接爆掉；
  // 已經是發起人就不必查，那已經是最高的了。
  if (!isHost && UUID_RE.test(editToken)) {
    const { rows } = await runner.query(
      'select role from orders where group_order_id = $1 and edit_token = $2::uuid',
      [group.id, editToken],
    );
    if (rows.length && RANK[rows[0].role] > RANK[role]) role = rows[0].role;
  }

  if (isHost) role = 'admin';

  return {
    isHost,
    isOwner,
    role,
    /** 改得動別人的單 */
    canManage: RANK[role] >= RANK.manager,
    /** 指派角色、關攤、改截止 */
    canGrant: RANK[role] >= RANK.admin,
  };
}

/** 協助管理者以上：代改別人的單、批次改狀態 */
export async function assertCanManage(runner, req, group, message = '只有管理者可以做這件事') {
  const actor = await resolveActor(runner, req, group);
  if (!actor.canManage) throw unauthorized(message);
  return actor;
}

/** 最高管理者以上：指派角色、關攤、改截止時間 */
export async function assertCanGrant(runner, req, group, message = '只有最高管理者可以做這件事') {
  const actor = await resolveActor(runner, req, group);
  if (!actor.canGrant) throw unauthorized(message);
  return actor;
}

/**
 * 能不能看到管理代碼：發起人，以及已經持有它的人（給了也是重複給）。
 *
 * 被指派的最高管理者不在此列：角色撤得掉，代碼撤不掉，
 * 讓角色換到代碼等於把一個可回收的權限換成不可回收的。
 */
export function canSeeManageCode(req, group) {
  return (
    header(req, 'X-Admin-Token') === group.admin_token ||
    header(req, 'X-Manage-Code').toUpperCase() === group.manage_code
  );
}

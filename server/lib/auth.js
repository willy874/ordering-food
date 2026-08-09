import { unauthorized } from './errors.js';

/**
 * 身分判定。
 *
 * 沒有帳號系統，一切都是憑證比對。三種身分，權力由大到小：
 *
 *   發起人 isHost     X-Admin-Token   關團、改截止、刪團、指派管理者，以及管理者能做的一切
 *   管理者 isManager  X-Manage-Code   代改任何人的單、批次推進度，不受截止時間限制
 *                     或 X-Edit-Token（該張單 is_manager = true）
 *   本人   isOwner    X-Edit-Token    只動自己那一張，受截止時間與品項狀態限制
 *
 * 管理者有兩條來源刻意做成等價：發起人可以把代碼念給任何人（連沒登記的人也行），
 * 也可以在清單頁直接勾選某個已登記的參與者——後者不必再傳一次代碼，他用自己
 * 原本的 edit_token 就有權限。
 *
 * 前端只用這些憑證決定按鈕顯不顯示，真正的把關一律在這裡。
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  let isManager = Boolean(manageCode) && manageCode === group.manage_code;

  // 被指派的管理者：用他自己的 edit_token 行使權限。
  // 先擋掉格式不對的字串，否則 uuid 轉型會讓查詢直接爆掉。
  if (!isHost && !isManager && UUID_RE.test(editToken)) {
    const { rowCount } = await runner.query(
      `select 1 from orders
        where group_order_id = $1 and edit_token = $2::uuid and is_manager = true`,
      [group.id, editToken],
    );
    isManager = rowCount > 0;
  }

  // 發起人本來就涵蓋管理者能做的一切，這裡把它攤平，呼叫端只要問 canManage
  return { isHost, isOwner, isManager: isManager || isHost, canManage: isHost || isManager };
}

/** 需要「管理者以上」的操作：代改別人的單、批次改狀態 */
export async function assertCanManage(runner, req, group, message = '只有發起人與管理者可以做這件事') {
  const actor = await resolveActor(runner, req, group);
  if (!actor.canManage) throw unauthorized(message);
  return actor;
}

/** 需要「發起人」的操作：關團、改截止、刪團、指派管理者 */
export function assertIsHost(req, group, message = '只有發起的人可以做這件事') {
  const adminToken = header(req, 'X-Admin-Token');
  if (!adminToken || adminToken !== group.admin_token) throw unauthorized(message);
}

/** 能不能看到管理代碼：發起人，以及已經持有它的人（給了也是重複給） */
export function canSeeManageCode(req, group) {
  return (
    header(req, 'X-Admin-Token') === group.admin_token ||
    header(req, 'X-Manage-Code').toUpperCase() === group.manage_code
  );
}

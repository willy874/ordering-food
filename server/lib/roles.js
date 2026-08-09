/**
 * 身分與角色 —— 純判斷，不碰資料庫、不碰 Express。
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
 * 前端只用這些憑證決定按鈕顯不顯示，真正的把關一律在 services/permissionService.js，
 * 那裡負責把「被指派的角色」從資料庫查出來，再交給這裡的 evaluateActor 下判斷。
 */

export const ROLES = ['participant', 'manager', 'admin'];

export const ROLE_LABELS = {
  participant: '參與者',
  manager: '協助管理者',
  admin: '最高管理者',
};

/** 角色高低。多個憑證同時存在時取最高的那個。 */
const RANK = { participant: 0, manager: 1, admin: 2 };

/** 發起人手上那把 adminToken */
export const isHostCredential = (credentials, group) =>
  Boolean(credentials.adminToken) && credentials.adminToken === group.adminToken;

/**
 * 判斷這次請求在這個團裡是什麼身分。
 *
 * @param credentials     controllers/http.js 從 header 讀出來的三組憑證
 * @param group           { adminToken, manageCode }
 * @param ownerEditToken  被操作的那張單的 editToken；沒有目標訂單時省略
 * @param assignedRole    這組 editToken 在本團被指派的角色，沒有則 null
 */
export function evaluateActor({ credentials, group, ownerEditToken = null, assignedRole = null }) {
  const isHost = isHostCredential(credentials, group);
  const isOwner =
    Boolean(credentials.editToken) &&
    Boolean(ownerEditToken) &&
    credentials.editToken === ownerEditToken;

  let role = 'participant';
  if (credentials.manageCode && credentials.manageCode === group.manageCode) role = 'manager';
  if (assignedRole && RANK[assignedRole] > RANK[role]) role = assignedRole;
  // 發起人恆為最高，不必再比
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

/**
 * 能不能看到管理代碼：發起人，以及已經持有它的人（給了也是重複給）。
 *
 * 被指派的最高管理者不在此列：角色撤得掉，代碼撤不掉，
 * 讓角色換到代碼等於把一個可回收的權限換成不可回收的。
 */
export const canSeeManageCode = (credentials, group) =>
  credentials.adminToken === group.adminToken || credentials.manageCode === group.manageCode;

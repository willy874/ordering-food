import { unauthorized } from '../lib/errors.js';
import { evaluateActor, isHostCredential } from '../lib/roles.js';
import { UUID_RE } from '../lib/validate.js';
import * as orderRepository from '../repositories/orderRepository.js';

/**
 * 權限判定。
 *
 * 純規則在 lib/roles.js，這裡負責唯一需要資料庫的那一步：
 * 「這組 editToken 在本團被指派了什麼角色」。
 *
 * 所有 service 的把關都經過這裡，controller 只負責把 header 上的憑證讀出來。
 */

/**
 * @param tx              executor（db 或交易中的 tx）
 * @param credentials     { editToken, adminToken, manageCode }
 * @param group           { id, adminToken, manageCode }
 * @param ownerEditToken  被操作的那張單的 editToken；沒有目標訂單時省略
 */
export async function resolveActor(tx, credentials, group, ownerEditToken = null) {
  // 先擋掉格式不對的字串，否則 uuid 轉型會讓查詢直接爆掉；
  // 已經是發起人就不必查，那已經是最高的了。
  const needsLookup = !isHostCredential(credentials, group) && UUID_RE.test(credentials.editToken);
  const assignedRole = needsLookup
    ? await orderRepository.findRoleByEditToken(tx, group.id, credentials.editToken)
    : null;

  return evaluateActor({ credentials, group, ownerEditToken, assignedRole });
}

/** 協助管理者以上：代改別人的單、批次改狀態 */
export async function assertCanManage(tx, credentials, group, message = '只有管理者可以做這件事') {
  const actor = await resolveActor(tx, credentials, group);
  if (!actor.canManage) throw unauthorized(message);
  return actor;
}

/** 最高管理者以上：指派角色、關攤、改截止時間 */
export async function assertCanGrant(
  tx,
  credentials,
  group,
  message = '只有最高管理者可以做這件事',
) {
  const actor = await resolveActor(tx, credentials, group);
  if (!actor.canGrant) throw unauthorized(message);
  return actor;
}

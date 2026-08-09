import { notFound } from '../lib/errors.js';
import { UUID_RE, parseIntId } from '../lib/validate.js';

/**
 * controller 共用的 HTTP 小工具。
 *
 * 這一層是唯一碰得到 Express req／res 的地方：把 header 與路徑參數換成
 * service 看得懂的普通值，service 與 repository 都不知道 HTTP 的存在。
 */

/**
 * 三組憑證。一律 trim，管理代碼另外轉大寫——它是用嘴巴念、用手打進去的。
 * 判斷規則見 lib/roles.js 與 services/permissionService.js。
 */
export function readCredentials(req) {
  const header = (name) => (req.get(name) || '').trim();
  return {
    editToken: header('X-Edit-Token'),
    adminToken: header('X-Admin-Token'),
    manageCode: header('X-Manage-Code').toUpperCase(),
  };
}

/**
 * 路徑上的整數 id。非數字直接當成找不到，不要送進 SQL 讓型別轉換變成 500。
 */
export function intParam(value, message) {
  const id = parseIntId(value);
  if (id === null) throw notFound(message);
  return id;
}

/** 路徑上的 uuid，同樣不能讓格式錯誤變成 500 */
export function uuidParam(value, message) {
  if (!UUID_RE.test(String(value))) throw notFound(message);
  return String(value);
}

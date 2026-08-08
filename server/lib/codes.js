import { randomInt } from 'node:crypto';

// 排除易混淆字元 I L O 0 1，因為團號會被口頭念出來或手動輸入
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * 產生一個資料庫中尚未使用的團號。
 * 6 碼在 31 個字元的字母表下約有 8.9 億種組合，實務上幾乎不會碰撞，
 * 但仍重試數次以防萬一。
 */
export async function generateUniqueJoinCode(client, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const code = generateJoinCode();
    const { rowCount } = await client.query(
      'select 1 from group_orders where join_code = $1',
      [code],
    );
    if (rowCount === 0) return code;
  }
  throw new Error('無法產生不重複的團號');
}

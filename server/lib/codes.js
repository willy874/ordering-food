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
 * 管理代碼。
 *
 * 與團號同一套字母表（一樣會被念出來），但長度拉到 8 碼：團號是給全桌的，
 * 管理代碼是給「可以改別人的單」的人，猜中的成本必須高得多。
 *
 * 不檢查全域唯一——它一律連同團號一起驗證，兩個團撞到同一組也不會互通。
 */
export const generateManageCode = () => generateJoinCode(8);

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

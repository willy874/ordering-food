import { MAX_PRICE } from '../components/ui.jsx';

/**
 * 菜單 CSV 解析。
 *
 * 為什麼在前端解析：貼上之後要先看得到「這 23 樣會進去、第 5 行有問題」才敢按
 * 匯入，錯誤得指到第幾行。後端因此只收乾淨的陣列（見 server/routes/stores.js）。
 *
 * 刻意寬鬆——來源是人手打的、從試算表複製的、從 LINE 貼過來的：
 *   分隔符自動判斷（Tab／半形逗號／全形逗號），從試算表直接複製過來是 Tab
 *   有沒有標題列都可以，第一格是「品名」就當標題跳過
 *   空白行與 # 開頭的行略過
 *   支援 "雙引號" 包住含逗號的欄位
 *
 * 不支援欄位內換行——菜名不會有換行，為此把解析器寫成狀態機不划算。
 */

export const MENU_CSV_HEADER = '品名,價格,分類,排序,價格待確認';

export const MENU_CSV_TEMPLATE = [
  MENU_CSV_HEADER,
  '蝦仁炒飯,180,主食,10,',
  '紅燒牛肉麵,220,主食,20,',
  '招牌調酒,,酒水,30,是',
  '# 價格留空 = 價格待確認，結帳時再補',
  '# 分類留空 = 主餐；排序留空 = 照這份清單的順序',
].join('\n');

const TRUTHY = new Set(['是', '對', 'y', 'yes', 'true', '1', 'v', '✓', 'o']);

/** 從第一行資料猜分隔符：出現最多次的那個 */
function detectDelimiter(line) {
  const counts = ['\t', ',', '，'].map((d) => [d, line.split(d).length - 1]);
  const [best, n] = counts.sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

/** 一行拆成欄位，支援雙引號包住的欄位（"珍奶, 半糖"） */
function splitRow(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/**
 * @returns {{ items: object[], errors: {line: number, raw: string, message: string}[] }}
 *   items 可直接送給 POST /stores/:id/menu/bulk
 */
export function parseMenuCsv(text) {
  const items = [];
  const errors = [];

  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter(({ raw }) => raw.trim() !== '' && !raw.trim().startsWith('#'));

  if (lines.length === 0) return { items, errors };

  const delimiter = detectDelimiter(lines[0].raw);

  for (const [index, { raw, line }] of lines.entries()) {
    const cells = splitRow(raw, delimiter);
    const [name, price, category, sortOrder, uncertain] = cells;

    // 標題列：只可能出現在第一行，判斷放寬到常見的幾種寫法
    if (index === 0 && /^(品名|名稱|品項|name|item)$/i.test(name)) continue;

    if (!name) {
      errors.push({ line, raw, message: '沒有品名' });
      continue;
    }
    if (name.length > 50) {
      errors.push({ line, raw, message: `品名過長（${name.length} 字，上限 50）` });
      continue;
    }

    // 價格留空是合法的：常見情況是「先建進來，實際多少錢問了才知道」
    const blankPrice = !price;
    const value = blankPrice ? 0 : Number(price.replace(/[$,＄，\s]/g, ''));
    if (!blankPrice && (!Number.isInteger(value) || value < 0 || value > MAX_PRICE)) {
      errors.push({ line, raw, message: `價格「${price}」需為 0 ~ ${MAX_PRICE} 的整數` });
      continue;
    }

    if (category && category.length > 20) {
      errors.push({ line, raw, message: `分類過長（${category.length} 字，上限 20）` });
      continue;
    }

    const order = Number(sortOrder);
    items.push({
      name,
      price: value,
      category: category || '主餐',
      ...(sortOrder && Number.isInteger(order) ? { sortOrder: order } : {}),
      priceUncertain: blankPrice || TRUTHY.has(String(uncertain ?? '').toLowerCase()),
    });
  }

  return { items, errors };
}

/**
 * 下載範本。
 * 前面加 BOM，否則 Excel 開起來中文全是亂碼——這個檔案的用途就是拿去 Excel 編輯。
 */
export function downloadMenuCsvTemplate(filename = '菜單匯入範本.csv') {
  const blob = new Blob([`﻿${MENU_CSV_TEMPLATE}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

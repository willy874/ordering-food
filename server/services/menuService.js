import { db, withTransaction } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { toMenuItem } from '../lib/serialize.js';
import * as menuItemRepository from '../repositories/menuItemRepository.js';
import * as storeRepository from '../repositories/storeRepository.js';

/** 匯入時沒指定排序，就照原順序接在既有品項後面；十位一階留空間讓人手動插隊 */
const SORT_STEP = 10;

export async function listMenu(storeId) {
  const rows = await menuItemRepository.listByStore(db, storeId);
  return rows.map(toMenuItem);
}

export async function createMenuItem(storeId, input) {
  // 已下架的店家仍可整理菜單，因此只確認這家店存在
  if (!(await storeRepository.findById(db, storeId))) throw notFound('找不到店家');

  const row = await menuItemRepository.insert(db, {
    storeId,
    name: input.name,
    price: input.price,
    category: input.category || '主餐',
    sortOrder: input.sortOrder ?? 0,
    priceUncertain: input.priceUncertain === true,
  });
  return toMenuItem(row);
}

/**
 * 一次匯入整份菜單。
 *
 * 換一家店時逐樣新增要按幾十次，而菜單通常已經以某種表格形式存在（照片打的、
 * 上次的試算表、店家給的清單）。整批進來就整批成立：一個 transaction，
 * 有一列不合法就整批退回，不會留下匯入到一半的菜單讓人不知道要從哪裡接。
 *
 * 沒有「先清空再匯入」的選項——那會把既有品項連同歷史訂單的參照一起刪掉
 * （menu_item_id 變 null）。要重來請先手動下架或刪除。
 */
export async function importMenuItems(storeId, items) {
  const created = await withTransaction(async (tx) => {
    if (!(await storeRepository.findById(tx, storeId))) throw notFound('找不到店家');

    const existing = await menuItemRepository.countByStore(tx, storeId);
    const base = existing * SORT_STEP;

    return menuItemRepository.insertMany(
      tx,
      items.map((item, index) => ({
        storeId,
        name: item.name,
        price: item.price,
        category: item.category || '主餐',
        // 貼上來的順序通常就是菜單上的順序
        sortOrder: item.sortOrder ?? base + index * SORT_STEP,
        priceUncertain: item.priceUncertain === true,
      })),
    );
  });

  return { created: created.length, items: created.map(toMenuItem) };
}

/** 只把有送來的欄位放進 set，沒送的維持原值 */
const PATCHABLE = ['name', 'price', 'category', 'available', 'sortOrder', 'priceUncertain'];

export async function updateMenuItem(id, input) {
  const patch = {};
  for (const key of PATCHABLE) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (Object.keys(patch).length === 0) throw badRequest('沒有要更新的欄位');

  const row = await menuItemRepository.update(db, id, patch);
  if (!row) throw notFound('找不到品項');
  return toMenuItem(row);
}

export async function deleteMenuItem(id) {
  const existed = await menuItemRepository.remove(db, id);
  if (!existed) throw notFound('找不到品項');
}

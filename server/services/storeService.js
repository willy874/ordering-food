import { db } from '../db.js';
import { notFound } from '../lib/errors.js';
import { toStore } from '../lib/serialize.js';
import * as storeRepository from '../repositories/storeRepository.js';

/**
 * 店家。
 *
 * 這一層決定業務規則（找不到就是 404、刪除其實是下架），
 * 查詢交給 repository，回傳的一律是可以直接送出的 DTO。
 */

export async function listStores() {
  const rows = await storeRepository.listActive(db);
  return rows.map(toStore);
}

export async function createStore(input) {
  const row = await storeRepository.insert(db, {
    name: input.name,
    phone: input.phone ?? null,
    note: input.note ?? null,
  });
  return toStore(row);
}

/** 下架而非真的刪除：歷史訂單還連著這家店 */
export async function deactivateStore(id) {
  const existed = await storeRepository.deactivate(db, id);
  if (!existed) throw notFound('找不到店家');
}

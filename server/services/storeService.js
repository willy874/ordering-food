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

/**
 * 修改店家資訊。只寫入這次帶來的欄位——沒送的欄位維持原值，
 * 送了 null 的（phone／note）則清空。至少要有一個欄位由 schema 保證。
 */
export async function updateStore(id, input) {
  const values = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.phone !== undefined) values.phone = input.phone ?? null;
  if (input.note !== undefined) values.note = input.note ?? null;

  const row = await storeRepository.update(db, id, values);
  if (!row) throw notFound('找不到店家');
  return toStore(row);
}

/** 下架而非真的刪除：歷史訂單還連著這家店 */
export async function deactivateStore(id) {
  const existed = await storeRepository.deactivate(db, id);
  if (!existed) throw notFound('找不到店家');
}

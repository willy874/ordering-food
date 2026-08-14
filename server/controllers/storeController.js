import { wrap } from '../lib/errors.js';
import { createStoreSchema, parse, patchStoreSchema } from '../lib/validate.js';
import * as storeService from '../services/storeService.js';
import { intParam } from './http.js';

/**
 * 店家的 HTTP 介面：驗證輸入、決定狀態碼，其餘一概交給 service。
 */

export const list = wrap(async (req, res) => {
  res.json(await storeService.listStores());
});

export const create = wrap(async (req, res) => {
  const input = parse(createStoreSchema, req.body);
  res.status(201).json(await storeService.createStore(input));
});

export const update = wrap(async (req, res) => {
  const id = intParam(req.params.id, '找不到店家');
  const input = parse(patchStoreSchema, req.body);
  res.json(await storeService.updateStore(id, input));
});

export const remove = wrap(async (req, res) => {
  await storeService.deactivateStore(intParam(req.params.id, '找不到店家'));
  res.status(204).end();
});

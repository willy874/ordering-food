import { wrap } from '../lib/errors.js';
import {
  bulkMenuItemsSchema,
  createMenuItemSchema,
  parse,
  patchMenuItemSchema,
} from '../lib/validate.js';
import * as menuService from '../services/menuService.js';
import { intParam } from './http.js';

export const list = wrap(async (req, res) => {
  const storeId = intParam(req.params.id, '找不到店家');
  res.json(await menuService.listMenu(storeId));
});

export const create = wrap(async (req, res) => {
  const storeId = intParam(req.params.id, '找不到店家');
  const input = parse(createMenuItemSchema, req.body);
  res.status(201).json(await menuService.createMenuItem(storeId, input));
});

export const bulkCreate = wrap(async (req, res) => {
  const storeId = intParam(req.params.id, '找不到店家');
  const input = parse(bulkMenuItemsSchema, req.body);
  res.status(201).json(await menuService.importMenuItems(storeId, input.items));
});

export const update = wrap(async (req, res) => {
  const id = intParam(req.params.id, '找不到品項');
  const input = parse(patchMenuItemSchema, req.body);
  res.json(await menuService.updateMenuItem(id, input));
});

export const remove = wrap(async (req, res) => {
  await menuService.deleteMenuItem(intParam(req.params.id, '找不到品項'));
  res.status(204).end();
});

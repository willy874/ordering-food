import { wrap } from '../lib/errors.js';
import {
  addOrderItemsSchema,
  createOrderSchema,
  orderStatusSchema,
  parse,
  patchOrderItemSchema,
  patchOrderRoleSchema,
  patchOrderSchema,
} from '../lib/validate.js';
import * as orderService from '../services/orderService.js';
import { intParam, readCredentials, uuidParam } from './http.js';

const orderId = (req) => uuidParam(req.params.orderId, '找不到訂單');
const itemId = (req) => intParam(req.params.itemId, '找不到品項');

/** 下單，同時也是登記暱稱。掛在團底下（POST /groups/:joinCode/orders） */
export const create = wrap(async (req, res) => {
  const input = parse(createOrderSchema, req.body);
  res.status(201).json(await orderService.createOrder(req.params.joinCode, input));
});

export const update = wrap(async (req, res) => {
  const input = parse(patchOrderSchema, req.body);
  res.json(await orderService.updateOrder(orderId(req), input, readCredentials(req)));
});

export const addItems = wrap(async (req, res) => {
  const input = parse(addOrderItemsSchema, req.body);
  res.status(201).json(await orderService.addItems(orderId(req), input, readCredentials(req)));
});

export const remove = wrap(async (req, res) => {
  await orderService.deleteOrder(orderId(req), readCredentials(req));
  res.status(204).end();
});

export const updateStatus = wrap(async (req, res) => {
  const input = parse(orderStatusSchema, req.body);
  res.json(await orderService.updateOrderStatus(orderId(req), input));
});

export const assignRole = wrap(async (req, res) => {
  const input = parse(patchOrderRoleSchema, req.body);
  res.json(await orderService.assignRole(orderId(req), input, readCredentials(req)));
});

export const updateItem = wrap(async (req, res) => {
  const input = parse(patchOrderItemSchema, req.body);
  res.json(await orderService.updateItem(itemId(req), input, readCredentials(req)));
});

export const removeItem = wrap(async (req, res) => {
  await orderService.deleteItem(itemId(req), readCredentials(req));
  res.status(204).end();
});

export const updateItemStatus = wrap(async (req, res) => {
  const input = parse(orderStatusSchema, req.body);
  res.json(await orderService.updateItemStatus(itemId(req), input));
});

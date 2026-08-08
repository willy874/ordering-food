import { z } from 'zod';
import { badRequest } from './errors.js';
import { ORDER_STATUSES } from './orderStatus.js';

const name = z.string().trim().min(1, '名稱不可為空').max(50, '名稱過長');
const money = z.number().int('金額必須是整數').min(0, '金額不可為負').max(9999, '金額上限 9999');

/**
 * 訂單品項：兩種形態
 *   菜單品項 — 只送 menuItemId 與 qty，名稱與價格由伺服器決定
 *   自填品項 — 送 name 與 unitPrice，由使用者自行輸入
 */
export const orderItemSchema = z.union([
  z.object({
    menuItemId: z.coerce.number().int().positive(),
    qty: z.number().int().min(1).max(99),
  }),
  z.object({
    menuItemId: z.null().optional(),
    name,
    unitPrice: money,
    qty: z.number().int().min(1).max(99),
    // 自填品項時使用者也可能不確定價格
    priceUncertain: z.boolean().optional(),
  }),
]);

export const createOrderSchema = z.object({
  personName: z.string().trim().min(1, '請填寫你的名字').max(20, '名字過長'),
  note: z.string().trim().max(200).optional().nullable(),
  items: z.array(orderItemSchema).min(1, '至少要點一樣').max(30, '品項過多'),
});

export const createGroupSchema = z.object({
  storeId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, '請填寫團名').max(50),
  hostName: z.string().trim().min(1, '請填寫你的名字').max(20),
  deadlineAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export const patchGroupSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  deadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

/** 發起人批次改狀態，例如跟店家點完後把整桌標成「已點單」 */
export const bulkStatusSchema = z.object({
  from: z.enum(ORDER_STATUSES).optional(),
  to: z.enum(ORDER_STATUSES),
});

export const createStoreSchema = z.object({
  name,
  phone: z.string().trim().max(30).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
});

export const createMenuItemSchema = z.object({
  name,
  price: money,
  category: z.string().trim().max(20).optional(),
  sortOrder: z.number().int().optional(),
  priceUncertain: z.boolean().optional(),
});

export const patchMenuItemSchema = z.object({
  name: name.optional(),
  price: money.optional(),
  category: z.string().trim().max(20).optional(),
  available: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  priceUncertain: z.boolean().optional(),
});

/** 用 schema 驗證，失敗時丟出帶有可讀訊息的 400 */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first.path.length ? `${first.path.join('.')}：` : '';
    throw badRequest(`${where}${first.message}`);
  }
  return result.data;
}

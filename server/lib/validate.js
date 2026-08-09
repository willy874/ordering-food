import { z } from 'zod';
import { badRequest } from './errors.js';
import { ORDER_STATUSES } from './orderStatus.js';
import { ROLES } from './auth.js';

const name = z.string().trim().min(1, '名稱不可為空').max(50, '名稱過長');
// 上限放到 20 萬：酒吧的整支酒與套餐（例如香檳王一支 18,000）會超過四位數，
// 舊的 9999 上限會讓這些品項無法在管理頁面新增或修改
const money = z.number().int('金額必須是整數').min(0, '金額不可為負').max(200000, '金額上限 200000');

/** 這一樣的要求（不要香菜、去冰）。整張單的通則另有 orders.note */
const itemNote = z.string().trim().max(100, '備註過長').optional().nullable();

/**
 * 分單：誰要一起付這一樣。
 *
 *   owner   只有點的人付（預設）
 *   all     全團平分，人在計算當下才解析
 *   custom  點的人 ＋ sharedWith 列出的人
 *
 * sharedWith 只列「其他人」，不含點的人自己——他必然要付，而且下單當下
 * 那張單的 id 還不存在。見 server/lib/split.js。
 */
const shareFields = {
  shareScope: z.enum(['owner', 'all', 'custom']).optional(),
  sharedWith: z.array(z.string().uuid('分單對象格式錯誤')).max(50, '分單人數過多').optional(),
};

/**
 * 訂單品項：兩種形態
 *   菜單品項 — 只送 menuItemId 與 qty，名稱與價格由伺服器決定
 *   自填品項 — 送 name 與 unitPrice，由使用者自行輸入
 */
export const orderItemSchema = z.union([
  z.object({
    menuItemId: z.coerce.number().int().positive(),
    qty: z.number().int().min(1).max(99),
    note: itemNote,
    ...shareFields,
  }),
  z.object({
    menuItemId: z.null().optional(),
    name,
    unitPrice: money,
    qty: z.number().int().min(1).max(99),
    // 自填品項時使用者也可能不確定價格
    priceUncertain: z.boolean().optional(),
    note: itemNote,
    ...shareFields,
  }),
]);

/**
 * 下單。
 *
 * items 允許為空：第一次進團要先登記暱稱，登記出來的就是一張還沒點東西的單。
 * 有了單才有身分，別人才選得到你來分單，你也才不必每次重打名字。
 */
export const createOrderSchema = z.object({
  personName: z.string().trim().min(1, '請填寫你的名字').max(20, '名字過長'),
  note: z.string().trim().max(200).optional().nullable(),
  items: z.array(orderItemSchema).max(30, '品項過多').optional().default([]),
});

/** 加點：往既有的單追加品項，不影響已經在單上的東西 */
export const addOrderItemsSchema = z.object({
  items: z.array(orderItemSchema).min(1, '至少要點一樣').max(30, '一次加太多了'),
});

/** 一張單累積下來的品項上限，避免無限加點把彙總撐爆 */
export const MAX_ITEMS_PER_ORDER = 60;

export const patchOrderSchema = z
  .object({
    personName: z.string().trim().min(1, '請填寫你的名字').max(20, '名字過長').optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '沒有要修改的欄位');

/**
 * 改單一品項。
 * 只改 qty、備註或分單會保留與菜單的連結；一旦動到名稱或價格，這一列就會轉成
 * 自填品項（菜單品項的名稱與價格必須與菜單一致，見 pricing.js 的信任模型）。
 */
export const patchOrderItemSchema = z
  .object({
    name: name.optional(),
    unitPrice: money.optional(),
    priceUncertain: z.boolean().optional(),
    qty: z.number().int().min(1).max(99).optional(),
    note: itemNote,
    ...shareFields,
  })
  .refine((value) => Object.keys(value).length > 0, '沒有要修改的欄位');

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

/**
 * 驗證管理代碼。
 * 大小寫與前後空白一律正規化——這組代碼是用嘴巴念、用手打進去的。
 */
export const manageCodeSchema = z.object({
  manageCode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().min(4, '請輸入完整的管理代碼').max(16, '管理代碼過長')),
});

/** 最高管理者指派某個參與者的角色 */
export const patchOrderRoleSchema = z.object({
  role: z.enum(ROLES),
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

/**
 * 一次匯入整份菜單。
 *
 * CSV 的解析在前端做——貼上之後要先看得到「這 23 樣會進去、這 2 行有問題」
 * 才敢按下去，錯誤要指到第幾行。後端收到的因此已經是乾淨的陣列。
 *
 * 300 的上限是防呆：一家店的菜單不會比這更長，超過通常是貼錯東西。
 */
export const bulkMenuItemsSchema = z.object({
  items: z.array(createMenuItemSchema).min(1, '至少要有一個品項').max(300, '一次最多 300 個品項'),
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

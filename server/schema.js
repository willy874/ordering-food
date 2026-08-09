import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — 對應 server/migrations/*.sql 套用完之後的資料庫實況。
 *
 * 這份檔案是「描述」而非「來源」：真正建立與變更結構的仍然是 migrations 目錄下
 * 那幾支手寫的 SQL（見 server/migrations/run.js）。理由是正式資料庫已經有資料，
 * 而幾支 migration 的註解裡寫明了它們刻意留下的過渡欄位與部署順序，
 * 交給 drizzle-kit 自動產生會把那些判斷洗掉。
 *
 * 因此改結構的流程是：先寫一支新的 .sql，再回頭同步這裡。
 * 兩邊對不上時以資料庫為準——這裡寫錯只會讓查詢在執行期壞掉。
 *
 * 金額一律是「整數台幣元」，不使用浮點數。
 */

export const stores = pgTable('stores', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  note: text('note'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const menuItems = pgTable(
  'menu_items',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    category: text('category').notNull().default('主餐'),
    available: boolean('available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // 只記得有這道菜、不記得價格時標記。彙總會註明總額為估算
    priceUncertain: boolean('price_uncertain').notNull().default(false),
  },
  (table) => [
    index('idx_menu_store').on(table.storeId, table.category, table.sortOrder),
    check('menu_items_price_check', sql`${table.price} >= 0`),
  ],
);

export const groupOrders = pgTable(
  'group_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 6 碼短碼，分享用
    joinCode: text('join_code').notNull().unique(),
    // 開團者憑證
    adminToken: uuid('admin_token').notNull().defaultRandom(),
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id),
    title: text('title').notNull(),
    hostName: text('host_name').notNull(),
    status: text('status').notNull().default('open'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // 8 碼管理代碼，連同 join_code 驗證；見 server/lib/roles.js
    manageCode: text('manage_code').notNull().default(sql`gen_group_manage_code()`),
  },
  (table) => [
    index('idx_groups_code').on(table.joinCode),
    check('group_orders_status_check', sql`${table.status} in ('open', 'closed')`),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupOrderId: uuid('group_order_id')
      .notNull()
      .references(() => groupOrders.id, { onDelete: 'cascade' }),
    personName: text('person_name').notNull(),
    // 整張單的通則（「我最後到，餐先冰著」）。單樣的要求放 orderItems.note
    note: text('note'),
    // 本人憑證
    editToken: uuid('edit_token').notNull().defaultRandom(),
    // 應付金額，排除已撤單品項，一律由 repositories/orderRepository.js 的 refreshTotal 重算
    total: integer('total').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // 由 trg_orders_updated 觸發器維護
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // participant／manager／admin，見 server/lib/roles.js
    role: text('role').notNull().default('participant'),

    // ── 以下兩組已棄用，僅為與資料庫實況一致而保留 ──────────────
    // 狀態改由 orderItems 持有（migration 0005）；程式不再讀寫
    status: text('status').notNull().default('pending'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 改由 orders.role 表達（migration 0008）
    isManager: boolean('is_manager').notNull().default(false),
  },
  (table) => [
    index('idx_orders_group').on(table.groupOrderId),
    // 同團不許同名：彙總按名字收錢，兩個「小明」是實質錯帳
    uniqueIndex('idx_orders_group_person').on(table.groupOrderId, table.personName),
    check('orders_role_check', sql`${table.role} in ('participant', 'manager', 'admin')`),
  ],
);

/**
 * menu_item_id 為 null 代表自填品項；name 與 unit_price 一律落地，
 * 讓菜單品項與自填品項在彙總與計價時走同一條路徑。
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    menuItemId: bigint('menu_item_id', { mode: 'number' }).references(() => menuItems.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    unitPrice: integer('unit_price').notNull(),
    qty: integer('qty').notNull(),
    isCustom: boolean('is_custom').generatedAlwaysAs(sql`menu_item_id is null`),
    // 下單當下的不確定性快照，菜單日後補上正確價格也不回頭改寫歷史
    priceUncertain: boolean('price_uncertain').notNull().default(false),
    // 狀態屬於品項而非整張單，見 server/lib/orderStatus.js
    status: text('status').notNull().default('pending'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 這一樣的要求，例如不要香菜
    note: text('note'),
    // owner／all／custom，見 server/lib/split.js
    shareScope: text('share_scope').notNull().default('owner'),
  },
  (table) => [
    index('idx_items_order').on(table.orderId),
    index('idx_items_order_status').on(table.orderId, table.status),
    check('order_items_qty_check', sql`${table.qty} > 0`),
    check('order_items_unit_price_check', sql`${table.unitPrice} >= 0`),
    check(
      'order_items_share_scope_check',
      sql`${table.shareScope} in ('owner', 'all', 'custom')`,
    ),
  ],
);

/**
 * 一個品項分給哪些人。只存「其他人」，不存擁有者自己——擁有者必然要付，
 * 而下單當下他那張單的 id 還不存在。
 */
export const orderItemShares = pgTable(
  'order_item_shares',
  {
    orderItemId: bigint('order_item_id', { mode: 'number' })
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.orderItemId, table.orderId] }),
    // 反向查詢：算某個人要付多少時，要找出所有把他列進去的品項
    index('idx_shares_order').on(table.orderId),
  ],
);

// ── relations：供 db.query.*.findMany 的巢狀讀取使用 ────────────────

export const storesRelations = relations(stores, ({ many }) => ({
  menuItems: many(menuItems),
  groupOrders: many(groupOrders),
}));

export const menuItemsRelations = relations(menuItems, ({ one }) => ({
  store: one(stores, { fields: [menuItems.storeId], references: [stores.id] }),
}));

export const groupOrdersRelations = relations(groupOrders, ({ one, many }) => ({
  store: one(stores, { fields: [groupOrders.storeId], references: [stores.id] }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  group: one(groupOrders, {
    fields: [orders.groupOrderId],
    references: [groupOrders.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
  shares: many(orderItemShares),
}));

export const orderItemSharesRelations = relations(orderItemShares, ({ one }) => ({
  item: one(orderItems, {
    fields: [orderItemShares.orderItemId],
    references: [orderItems.id],
  }),
  order: one(orders, { fields: [orderItemShares.orderId], references: [orders.id] }),
}));

import { Router } from 'express';
import { query } from '../db.js';
import { wrap, notFound } from '../lib/errors.js';
import { toStore, toMenuItem } from '../lib/serialize.js';
import { parse, createStoreSchema, createMenuItemSchema, patchMenuItemSchema } from '../lib/validate.js';

const router = Router();

router.get(
  '/stores',
  wrap(async (req, res) => {
    const { rows } = await query(
      'select * from stores where active = true order by name',
    );
    res.json(rows.map(toStore));
  }),
);

router.post(
  '/stores',
  wrap(async (req, res) => {
    const input = parse(createStoreSchema, req.body);
    const { rows } = await query(
      'insert into stores (name, phone, note) values ($1, $2, $3) returning *',
      [input.name, input.phone ?? null, input.note ?? null],
    );
    res.status(201).json(toStore(rows[0]));
  }),
);

router.delete(
  '/stores/:id',
  wrap(async (req, res) => {
    const { rowCount } = await query(
      'update stores set active = false where id = $1',
      [req.params.id],
    );
    if (!rowCount) throw notFound('找不到店家');
    res.status(204).end();
  }),
);

router.get(
  '/stores/:id/menu',
  wrap(async (req, res) => {
    const { rows } = await query(
      `select * from menu_items
        where store_id = $1
        order by category, sort_order, id`,
      [req.params.id],
    );
    res.json(rows.map(toMenuItem));
  }),
);

router.post(
  '/stores/:id/menu',
  wrap(async (req, res) => {
    const input = parse(createMenuItemSchema, req.body);
    const store = await query('select 1 from stores where id = $1', [req.params.id]);
    if (!store.rowCount) throw notFound('找不到店家');

    const { rows } = await query(
      `insert into menu_items (store_id, name, price, category, sort_order, price_uncertain)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [
        req.params.id,
        input.name,
        input.price,
        input.category || '主餐',
        input.sortOrder ?? 0,
        input.priceUncertain === true,
      ],
    );
    res.status(201).json(toMenuItem(rows[0]));
  }),
);

router.patch(
  '/menu-items/:id',
  wrap(async (req, res) => {
    const input = parse(patchMenuItemSchema, req.body);

    const columns = {
      name: 'name',
      price: 'price',
      category: 'category',
      available: 'available',
      sortOrder: 'sort_order',
      priceUncertain: 'price_uncertain',
    };

    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] !== undefined) {
        params.push(input[key]);
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (!sets.length) throw notFound('沒有要更新的欄位');

    params.push(req.params.id);
    const { rows } = await query(
      `update menu_items set ${sets.join(', ')} where id = $${params.length} returning *`,
      params,
    );
    if (!rows.length) throw notFound('找不到品項');
    res.json(toMenuItem(rows[0]));
  }),
);

router.delete(
  '/menu-items/:id',
  wrap(async (req, res) => {
    const { rowCount } = await query('delete from menu_items where id = $1', [req.params.id]);
    if (!rowCount) throw notFound('找不到品項');
    res.status(204).end();
  }),
);

export default router;

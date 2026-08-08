-- 團購訂餐系統 — 初始 schema
-- 金額一律以「整數台幣元」儲存，不使用浮點數

create table if not exists stores (
  id         bigint generated always as identity primary key,
  name       text not null,
  phone      text,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists menu_items (
  id         bigint generated always as identity primary key,
  store_id   bigint  not null references stores(id) on delete cascade,
  name       text    not null,
  price      int     not null check (price >= 0),
  category   text    not null default '主餐',
  available  boolean not null default true,
  sort_order int     not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists group_orders (
  id          uuid primary key default gen_random_uuid(),
  join_code   text not null unique,                          -- 6 碼短碼，分享用
  admin_token uuid not null default gen_random_uuid(),        -- 開團者憑證
  store_id    bigint not null references stores(id),
  title       text not null,
  host_name   text not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  deadline_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  group_order_id uuid not null references group_orders(id) on delete cascade,
  person_name    text not null,
  note           text,
  edit_token     uuid not null default gen_random_uuid(),     -- 本人憑證
  total          int  not null default 0 check (total >= 0),  -- 一律由伺服器計算
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- menu_item_id 為 null 代表自填品項；name 與 unit_price 一律儲存，
-- 使菜單品項與自填品項在彙總與計價時走同一條路徑
create table if not exists order_items (
  id           bigint generated always as identity primary key,
  order_id     uuid   not null references orders(id) on delete cascade,
  menu_item_id bigint references menu_items(id) on delete set null,
  name         text   not null,
  unit_price   int    not null check (unit_price >= 0),
  qty          int    not null check (qty > 0),
  is_custom    boolean generated always as (menu_item_id is null) stored
);

create index if not exists idx_menu_store    on menu_items   (store_id, category, sort_order);
create index if not exists idx_orders_group  on orders       (group_order_id);
create index if not exists idx_items_order   on order_items  (order_id);
create index if not exists idx_groups_code   on group_orders (join_code);

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_orders_updated on orders;
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

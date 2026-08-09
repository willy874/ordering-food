-- 點單狀態下放到單一品項
--
-- 原本狀態掛在整張訂單上，一次聚會因此只能有一種進度。
-- 實際情況是一輪一輪加點：先點的已經到餐，後加的還沒跟店家開口，
-- 整張單根本沒有單一狀態可言。狀態改由品項持有，訂單層級的狀態
-- 一律從品項推導（見 server/lib/orderStatus.js 的 rollupStatus）。
--
-- 這個 migration 刻意只做「加欄位」，不動既有欄位：
-- 它會在新版程式部署之前就跑完，這段期間舊版前端還在線上，
-- 砍掉 orders.status 會讓舊版當場壞掉，也沒有回頭路。
-- orders.status 與 orders.status_changed_at 至此已無人讀寫，
-- 確認新版上線無誤後，再用下面這段收尾：
--
--   drop index if exists idx_orders_group_status;
--   alter table orders drop column status;
--   alter table orders drop column status_changed_at;

alter table order_items
  add column if not exists status text not null default 'pending',
  add column if not exists status_changed_at timestamptz not null default now();

-- 既有資料：把整張單的狀態複製到它的每一個品項。
-- 檢查來源欄位是否還在，讓這段在收尾之後仍可重複執行。
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'orders' and column_name = 'status'
  ) then
    update order_items i
       set status = o.status,
           status_changed_at = o.status_changed_at
      from orders o
     where o.id = i.order_id;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_status_check'
  ) then
    alter table order_items
      add constraint order_items_status_check
      check (status in ('pending', 'ordered', 'served', 'cancel_requested', 'cancelled'));
  end if;
end $$;

create index if not exists idx_items_order_status on order_items (order_id, status);

-- orders.total 的定義隨之收斂為「應付金額」：已撤單的品項不計入。
-- 由 server/lib/pricing.js 的 refreshOrderTotal 於每次品項異動後重算。
comment on column orders.total is '應付金額，排除已撤單品項，一律由伺服器重算';
comment on column orders.status is '已棄用：狀態改由 order_items.status 持有，待新版上線後移除';

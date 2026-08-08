-- 訂單狀態
--
-- 追蹤「App 內湊單 → 跟店家點 → 出餐」的真實流程。
-- 已撤單（cancelled）不列入結帳金額，計算在 buildSummary 中排除。

alter table orders
  add column if not exists status text not null default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_status_check'
  ) then
    alter table orders
      add constraint orders_status_check
      check (status in ('pending', 'ordered', 'served', 'cancel_requested', 'cancelled'));
  end if;
end $$;

alter table orders
  add column if not exists status_changed_at timestamptz not null default now();

create index if not exists idx_orders_group_status on orders (group_order_id, status);

-- 三層權限
--
-- 0007 只給了一個布林 is_manager，實際用起來少一層：把管理權給出去的人
-- 自己也需要能再給出去——發起人不會整晚盯著手機等別人來要權限。
--
--   participant  參與者      只動得了自己那張單，且受品項狀態限制
--   manager      協助管理者  可以改清單上所有人的所有品項、批次推進度
--   admin        最高管理者  再加上「指派別人的角色」與關攤／改截止
--
-- 發起人（持 admin_token）恆為 admin，不需要也不依賴這個欄位——他的憑證
-- 不是 order 的 edit_token，而且他可能根本還沒登記暱稱。刪攤仍然只有他做得到：
-- 那會連同所有人的單一起消失，不該是一個「可以被指派出去」的權力。
--
-- 管理代碼（group_orders.manage_code）等同 manager，不含指派權——代碼給出去
-- 收不回來，能拿它再生出更多管理者的話就再也收束不了了。
--
-- 同 0005 的做法，這裡只加欄位不動舊的：migration 會在新版程式部署之前跑完，
-- 那段期間舊版還在線上讀寫 is_manager。確認新版無誤後再收尾：
--
--   alter table orders drop column is_manager;

alter table orders add column if not exists role text not null default 'participant';

-- 既有的管理者升級成協助管理者。檢查來源欄位是否還在，讓這段在收尾之後仍可重跑。
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'orders' and column_name = 'is_manager'
  ) then
    update orders set role = 'manager' where role = 'participant' and is_manager = true;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_role_check') then
    alter table orders
      add constraint orders_role_check
      check (role in ('participant', 'manager', 'admin'));
  end if;
end $$;

comment on column orders.role       is 'participant／manager／admin，見 server/lib/auth.js';
comment on column orders.is_manager is '已棄用：改由 orders.role 表達，待新版上線後移除';

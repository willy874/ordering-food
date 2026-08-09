-- 管理代碼與管理者
--
-- 原本只有兩種身分：發起人（admin_token）與本人（edit_token）。實際用起來
-- 少了中間那一層——發起人自己也在吃飯，收拾殘局的常常是坐在他旁邊那個人，
-- 但要把 admin_token 給出去等於把刪團的權力一起給出去。
--
-- 於是加一個「管理者」：能改任何人的單、能批次推進度，但關團、刪團、改截止
-- 與「指派誰是管理者」仍然只有發起人做得到。
--
-- 兩條路都通往同一個身分：
--
--   1. group_orders.manage_code — 開團時產生的 8 碼代碼，只有發起人看得到。
--      把代碼念給誰，誰就是管理者（HTTP header X-Manage-Code）。不需要事先登記，
--      所以連「幫忙結帳但沒點東西的人」也能用。
--
--   2. orders.is_manager — 發起人在清單頁直接把某個已登記的參與者標成管理者。
--      那個人用自己原本的 edit_token 就有管理權，不必再傳一次代碼。
--
-- manage_code 不需要全域唯一：它一律連同 join_code 一起驗證，兩個不同的團
-- 撞到同一組代碼也不會互通。

create or replace function gen_group_manage_code() returns text
language sql volatile as $$
  select string_agg(
           substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1),
           ''
         )
    from generate_series(1, 8);
$$;

alter table group_orders add column if not exists manage_code text;

-- 既有的團補一組代碼。這裡刻意用函式而非行內的 select：
-- 不相關的子查詢可能只被求值一次，整批團就會拿到同一組代碼。
update group_orders set manage_code = gen_group_manage_code() where manage_code is null;

-- 保留 default，讓還沒換版的程式碼在部署空窗期插入時不會撞上 not null
alter table group_orders alter column manage_code set default gen_group_manage_code();
alter table group_orders alter column manage_code set not null;

alter table orders add column if not exists is_manager boolean not null default false;

comment on column group_orders.manage_code is '管理代碼，8 碼，連同 join_code 驗證；見 server/lib/auth.js';
comment on column orders.is_manager        is '發起人指派的管理者，可代改全團訂單，但不能關團／刪團／再指派';

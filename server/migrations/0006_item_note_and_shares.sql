-- 品項備註與分單
--
-- 兩件事：
--
-- 1. 備註下放到品項。原本備註掛在整張單上（「不要香菜」），但一個人點三樣時
--    這句話到底是講哪一樣並不明確。order_items.note 讓每一樣各自帶自己的要求，
--    orders.note 保留給整張單的通則（例如「我最後到，餐先冰著」）。
--
-- 2. 分單。一瓶酒、一份大拼盤本來就不是一個人吃的，記在誰頭上都會讓那個人
--    被多收錢。改由品項自己說明「這筆該分給誰」：
--
--      owner   只有點的人付（預設，等同這個功能上線前的行為）
--      all     全團平分，人是動態解析的——後面才加入的人也會被算進去
--      custom  點的人 ＋ order_item_shares 裡列出的人
--
--    custom 只存「其他人」，不存擁有者自己：擁有者必然要付，而下單當下
--    那張單的 id 還不存在，存進去會變成先有蛋才有雞。
--
--    金額不落地成欄位，一律在讀取時由 server/lib/split.js 依當下的參與者重算。
--    有人退出或加入時「全部平分」的結果會自己跟著變，不需要回頭改任何一列。

alter table order_items
  add column if not exists note        text,
  add column if not exists share_scope text not null default 'owner';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_share_scope_check'
  ) then
    alter table order_items
      add constraint order_items_share_scope_check
      check (share_scope in ('owner', 'all', 'custom'));
  end if;
end $$;

-- 一個品項分給哪些人。order_id 指向該人在本團的那張單，
-- 兩邊都 cascade：品項刪掉、或被分擔的人整張單被刪掉，這一列都該跟著消失。
create table if not exists order_item_shares (
  order_item_id bigint not null references order_items(id) on delete cascade,
  order_id      uuid   not null references orders(id)      on delete cascade,
  primary key (order_item_id, order_id)
);

-- 反向查詢：算某個人要付多少時，要找出所有把他列進去的品項
create index if not exists idx_shares_order on order_item_shares (order_id);

comment on column order_items.note        is '這一樣的要求，例如不要香菜；整張單的通則放 orders.note';
comment on column order_items.share_scope is 'owner／all／custom，見 server/lib/split.js';

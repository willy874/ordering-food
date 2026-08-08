-- 價格未確認標記
--
-- 使用情境：建菜單時只記得有這道菜、不記得確切價格，或如本專案的 seed 資料
-- 僅從公開食記查到品名而無定價。標記後仍可正常下單與計算，
-- 但彙總會明確標示總額為估算，避免有人拿著錯的金額去收錢。

alter table menu_items
  add column if not exists price_uncertain boolean not null default false;

-- 下單當下的不確定性也要快照：菜單日後補上正確價格時，
-- 不應回頭改寫歷史訂單「當時是估價」這個事實
alter table order_items
  add column if not exists price_uncertain boolean not null default false;

-- 重複與同名的處理
--
-- 同一團內不允許同名下單者。彙總是按 person_name 結算收錢的，
-- 兩個「小明」會讓收錢的人無法判斷誰付過，屬於實質錯帳而非美觀問題。
-- 真的有兩個同名的人時，請用「小明(工程)」「小明(業務)」這類方式區隔。
--
-- 團名本身不強制唯一 —— 每週都叫「週三午餐」是合理的，
-- 改以建立時間與團號在介面上區隔。

-- 若既有資料已存在同名，先讓後出現的那筆帶上序號，避免建立索引失敗
with dupes as (
  select id,
         row_number() over (
           partition by group_order_id, person_name order by created_at, id
         ) as seq
    from orders
)
update orders o
   set person_name = o.person_name || ' (' || d.seq || ')'
  from dupes d
 where d.id = o.id
   and d.seq > 1;

create unique index if not exists idx_orders_group_person
  on orders (group_order_id, person_name);

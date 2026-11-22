-- مدينتنا: الأكل اليومي + بيتك ما بيتأجّر
-- 1) نسكّر حساب كل واحد بالدخل القديم لحد هلأ، عشان التغيير يمشي من هاللحظة بس
select hartna_settle(username) from players;

-- 2) الدخل الجديد بالساعة:
--    📱 6 من الموبايل − 🍞 2 أكل (48 باليوم)
--    🏠 بيتك اللي ساكن فيه (home) = 0، 🏘️ كل بيت زيادة (house) = 4
create or replace function hartna_income(p_username text) returns numeric
language sql stable security definer set search_path = public as $$
  -- 📱 6 − 🍞 2 أكل (48 باليوم)
  -- 🏠 البيت اللي ساكن فيه ما بيتأجّر؛ كل بيت زيادة (مشترى أو من السوق) بيجيب 4
  select 6 - 2
    + 4 * greatest(count(*) filter (where type in ('home', 'house')) - 1, 0)
    + coalesce(sum(case type when 'stall' then 4 when 'shop' then 15
        when 'building' then 120 when 'tower' then 600 else 0 end), 0)
  from items where owner = p_username
$$;

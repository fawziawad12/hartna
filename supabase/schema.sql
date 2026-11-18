-- =====================================================================
--  حارتنا · Hartna backend (Supabase / Postgres)
--  Paste this whole file into Supabase → SQL Editor → Run. Safe to run again.
--  Everything the website does goes through the rpc functions below;
--  visitors (anon key) can't touch the tables directly.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- scheduling + web requests (to read Instagram comments). Supabase has both; skipped elsewhere.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- ---------- tables ---------------------------------------------------
create table if not exists settings (
  key   text primary key,
  value text
);

create table if not exists players (
  username      text primary key,                 -- instagram username, lowercase
  number        int unique not null,              -- join order (1 = first)
  display_name  text,
  age           int check (age between 5 and 120),
  outfit        text not null default 'hartna',
  joined_at     timestamptz not null default now(),
  balance       numeric not null default 0,       -- money at balance_at
  balance_at    timestamptz not null default now(),
  verified      boolean not null default false,
  session_hash  text,
  comments      int not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists items (
  id          bigint generated always as identity primary key,
  owner       text not null references players(username) on update cascade,
  type        text not null,                      -- home | house | stall | shop | floor | car | building | tower | outfit
  ref         text,                               -- outfit key, etc.
  plot_index  int unique,                         -- which house lot (homes/houses only)
  for_sale    int check (for_sale > 0),           -- asking price when listed on the house market
  bought_at   timestamptz not null default now()
);

create table if not exists login_codes (
  username   text primary key,
  code       text not null,
  expires    timestamptz not null,
  verified   boolean not null default false
);

create table if not exists comments (
  id          text primary key,                   -- instagram comment id
  username    text not null,
  media_id    text,
  text        text,
  created_at  timestamptz,
  rewarded    boolean not null default false
);

create table if not exists ig_requests (
  request_id  bigint primary key,
  kind        text not null,                      -- media | comments | profile | refresh
  media_id    text,
  created_at  timestamptz not null default now()
);

alter table settings     enable row level security;
alter table players      enable row level security;
alter table items        enable row level security;
alter table login_codes  enable row level security;
alter table comments     enable row level security;
alter table ig_requests  enable row level security;
-- no policies: only the security-definer functions below can read/write.

-- ---------- game rules (keep in sync with src/economy.js) --------------
create or replace function hartna_price(p_type text, p_ref text default null) returns int
language sql immutable as $$
  select case p_type
    when 'stall' then 500 when 'shop' then 3000 when 'floor' then 8000 when 'house' then 12000
    when 'car' then 30000 when 'building' then 150000 when 'tower' then 1000000
    when 'outfit' then case p_ref when 'thobe' then 800 when 'abaya' then 800 when 'jalabiya' then 1200
                                  when 'casual' then 400 when 'gold' then 20000 else null end
    else null end
$$;

create or replace function hartna_income(p_username text) returns numeric
language sql stable security definer set search_path = public as $$
  select 6 + coalesce(sum(case type
    when 'home' then 4 when 'house' then 4 when 'stall' then 4 when 'shop' then 15
    when 'building' then 120 when 'tower' then 600 else 0 end), 0)
  from items where owner = p_username
$$;

create or replace function hartna_balance(p players) returns numeric
language sql stable as $$
  select p.balance + hartna_income(p.username) * extract(epoch from (now() - p.balance_at)) / 3600
$$;

-- bring a player's stored balance up to now (call before any change to income or money)
create or replace function hartna_settle(p_username text) returns numeric
language plpgsql security definer set search_path = public as $$
declare b numeric;
begin
  select hartna_balance(p) into b from players p where username = p_username for update;
  update players set balance = b, balance_at = now() where username = p_username;
  return b;
end $$;

create or replace function hartna_norm(p text) returns text
language sql immutable as $$ select lower(regexp_replace(trim(coalesce(p, '')), '^@', '')) $$;

-- next free house lot (1..100 are the free homes, in join order)
create or replace function hartna_free_lot() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(plot_index), 100) + 1 from items where plot_index > 100
$$;

-- add someone to the city (from a comment, or by the admin)
create or replace function hartna_add_resident(p_username text, p_name text default null, p_joined timestamptz default now())
returns players language plpgsql security definer set search_path = public as $$
declare u text := hartna_norm(p_username); n int; r players;
begin
  if u = '' then raise exception 'empty username'; end if;
  select * into r from players where username = u;
  if found then return r; end if;
  select coalesce(max(number), 0) + 1 into n from players;
  insert into players (username, number, display_name, joined_at, balance_at)
    values (u, n, nullif(trim(p_name), ''), p_joined, p_joined) returning * into r;
  if n <= 100 then
    insert into items (owner, type, plot_index, bought_at) values (u, 'home', n, p_joined);
  end if;
  return r;
end $$;

-- ---------- session helpers ---------------------------------------------
create or replace function hartna_me(p_token text) returns players
language plpgsql stable security definer set search_path = public as $$
declare r players;
begin
  select * into r from players
   where session_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then raise exception 'not logged in' using errcode = '28000'; end if;
  return r;
end $$;

create or replace function hartna_is_admin(p_password text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from settings where key = 'admin_password_hash'
                 and value = encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex'))
$$;

-- =====================================================================
--  PUBLIC API  (called from the website with the anon key)
-- =====================================================================

-- everything the map needs, in one call
create or replace function get_city() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'followers', coalesce((select value::int from settings where key = 'followers'), (select count(*) from players)),
    'instagram', (select value from settings where key = 'instagram'),
    'now', now(),
    'residents', coalesce((select json_agg(json_build_object(
        'username', p.username, 'name', p.display_name, 'number', p.number, 'age', p.age,
        'outfit', p.outfit, 'joinedAt', p.joined_at, 'verified', p.verified,
        'balance', round(p.balance, 2), 'balanceAt', p.balance_at, 'income', hartna_income(p.username),
        'assets', coalesce((select json_agg(json_build_object('id', i.id, 'type', i.type, 'ref', i.ref,
                   'plotIndex', i.plot_index, 'forSale', i.for_sale) order by i.id)
                   from items i where i.owner = p.username), '[]'::json)
      ) order by p.number) from players p), '[]'::json)
  )
$$;

-- step 1 of logging in: get a code to comment on a post
create or replace function request_code(p_username text) returns json
language plpgsql security definer set search_path = public as $$
declare u text := hartna_norm(p_username); c text;
begin
  if u !~ '^[a-z0-9._]{1,30}$' then raise exception 'bad username'; end if;
  c := 'HRT-' || lpad((floor(random() * 10000))::int::text, 4, '0');
  insert into login_codes (username, code, expires) values (u, c, now() + interval '30 minutes')
    on conflict (username) do update set code = excluded.code, expires = excluded.expires, verified = false;
  return json_build_object('code', c, 'expires', now() + interval '30 minutes');
end $$;

-- step 2: the site keeps asking until the comment with the code arrived; then it gets a session token once
create or replace function check_code(p_username text, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare u text := hartna_norm(p_username); lc login_codes; tok text;
begin
  select * into lc from login_codes where username = u and code = upper(trim(p_code)) and expires > now();
  if not found then return json_build_object('status', 'expired'); end if;
  if not lc.verified then return json_build_object('status', 'waiting'); end if;
  perform hartna_add_resident(u);
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  update players set session_hash = encode(extensions.digest(tok, 'sha256'), 'hex'), verified = true where username = u;
  delete from login_codes where username = u;
  return json_build_object('status', 'ok', 'token', tok, 'username', u);
end $$;

create or replace function my_profile(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare r players := hartna_me(p_token);
begin
  return json_build_object('username', r.username, 'name', r.display_name, 'age', r.age, 'outfit', r.outfit,
    'number', r.number, 'balance', round(hartna_balance(r), 2), 'income', hartna_income(r.username),
    'assets', coalesce((select json_agg(json_build_object('id', i.id, 'type', i.type, 'ref', i.ref,
               'plotIndex', i.plot_index, 'forSale', i.for_sale) order by i.id) from items i where i.owner = r.username), '[]'::json));
end $$;

create or replace function update_profile(p_token text, p_name text, p_age int) returns json
language plpgsql security definer set search_path = public as $$
declare r players := hartna_me(p_token);
begin
  if length(coalesce(p_name, '')) > 40 then raise exception 'name too long'; end if;
  update players set display_name = nullif(trim(p_name), ''), age = p_age where username = r.username;
  return my_profile(p_token);
end $$;

-- buy something from the shop
create or replace function buy(p_token text, p_type text, p_ref text default null) returns json
language plpgsql security definer set search_path = public as $$
declare r players := hartna_me(p_token); price int := hartna_price(p_type, p_ref); b numeric; lot int;
begin
  if price is null then raise exception 'unknown item'; end if;
  if p_type = 'outfit' and exists (select 1 from items where owner = r.username and type = 'outfit' and ref = p_ref) then
    raise exception 'already owned';
  end if;
  if p_type = 'floor' and not exists (select 1 from items where owner = r.username and type in ('home', 'house')) then
    raise exception 'you need a house first';
  end if;
  perform pg_advisory_xact_lock(42);              -- one purchase at a time (lots, balances)
  b := hartna_settle(r.username);
  if b < price then raise exception 'not enough money'; end if;
  update players set balance = balance - price where username = r.username;
  if p_type = 'house' then lot := hartna_free_lot(); end if;
  insert into items (owner, type, ref, plot_index) values (r.username, p_type, p_ref, lot);
  if p_type = 'outfit' then update players set outfit = p_ref where username = r.username; end if;
  return my_profile(p_token);
end $$;

create or replace function wear(p_token text, p_outfit text) returns json
language plpgsql security definer set search_path = public as $$
declare r players := hartna_me(p_token);
begin
  if p_outfit <> 'hartna' and not exists (select 1 from items where owner = r.username and type = 'outfit' and ref = p_outfit) then
    raise exception 'buy it first';
  end if;
  update players set outfit = p_outfit where username = r.username;
  return my_profile(p_token);
end $$;

-- house market: list (price) or unlist (null) one of your houses
create or replace function list_house(p_token text, p_item bigint, p_price int) returns json
language plpgsql security definer set search_path = public as $$
declare r players := hartna_me(p_token);
begin
  update items set for_sale = p_price where id = p_item and owner = r.username and type in ('home', 'house');
  if not found then raise exception 'not your house'; end if;
  return my_profile(p_token);
end $$;

create or replace function buy_house(p_token text, p_item bigint) returns json
language plpgsql security definer set search_path = public as $$
declare r players := hartna_me(p_token); it items; b numeric;
begin
  perform pg_advisory_xact_lock(42);
  select * into it from items where id = p_item and for_sale is not null and type in ('home', 'house') for update;
  if not found then raise exception 'not for sale'; end if;
  if it.owner = r.username then raise exception 'already yours'; end if;
  b := hartna_settle(r.username);
  perform hartna_settle(it.owner);
  if b < it.for_sale then raise exception 'not enough money'; end if;
  update players set balance = balance - it.for_sale where username = r.username;
  update players set balance = balance + it.for_sale where username = it.owner;
  update items set owner = r.username, for_sale = null, bought_at = now() where id = it.id;
  return my_profile(p_token);
end $$;

create or replace function logout(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare r players := hartna_me(p_token);
begin
  update players set session_hash = null where username = r.username;
end $$;

-- ---------- admin (password set once in settings, see README) ----------
create or replace function admin_add(p_password text, p_username text, p_name text default null) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not hartna_is_admin(p_password) then raise exception 'not admin'; end if;
  perform hartna_add_resident(p_username, p_name);
  return get_city();
end $$;

-- approve a login code by hand (before Instagram is connected)
create or replace function admin_verify(p_password text, p_username text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not hartna_is_admin(p_password) then raise exception 'not admin'; end if;
  update login_codes set verified = true where username = hartna_norm(p_username);
  return json_build_object('ok', found);
end $$;

create or replace function admin_give(p_password text, p_username text, p_amount int) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not hartna_is_admin(p_password) then raise exception 'not admin'; end if;
  perform hartna_settle(hartna_norm(p_username));
  update players set balance = balance + p_amount where username = hartna_norm(p_username);
  return json_build_object('ok', found);
end $$;

-- =====================================================================
--  INSTAGRAM COMMENTS  (automatic, every 5 minutes, with pg_cron + pg_net)
--  Needs in settings: ig_token (long-lived Instagram token).
-- =====================================================================

-- one comment arrives: new commenters join the city, codes log people in, comments earn money
create or replace function hartna_ingest_comment(p_id text, p_username text, p_media text, p_text text, p_time timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare u text := hartna_norm(p_username); today int;
begin
  if u = '' or exists (select 1 from comments where id = p_id) then return; end if;
  if u = (select value from settings where key = 'instagram') then return; end if; -- the account itself
  insert into comments (id, username, media_id, text, created_at) values (p_id, u, p_media, p_text, p_time);
  perform hartna_add_resident(u, null, coalesce(p_time, now()));
  update login_codes set verified = true
   where username = u and expires > now() and position(code in upper(coalesce(p_text, ''))) > 0;
  -- +50 per comment, at most 10 rewarded comments a day
  select count(*) into today from comments where username = u and rewarded and created_at > now() - interval '1 day';
  if today < 10 then
    perform hartna_settle(u);
    update players set balance = balance + 50, comments = comments + 1 where username = u;
    update comments set rewarded = true where id = p_id;
  end if;
end $$;

-- send the requests (pg_net is asynchronous)
create or replace function hartna_poll_instagram() returns void
language plpgsql security definer set search_path = public as $$
declare tok text := (select value from settings where key = 'ig_token'); rid bigint; m record;
begin
  if tok is null then return; end if;
  -- recent posts
  select net.http_get('https://graph.instagram.com/v21.0/me/media?fields=id,timestamp&limit=8&access_token=' || tok) into rid;
  insert into ig_requests (request_id, kind) values (rid, 'media');
  -- profile: username + follower count
  select net.http_get('https://graph.instagram.com/v21.0/me?fields=username,followers_count&access_token=' || tok) into rid;
  insert into ig_requests (request_id, kind) values (rid, 'profile');
  -- comments of the posts we know
  for m in select value as media_id from json_array_elements_text(coalesce((select value from settings where key = 'ig_media'), '[]')::json) loop
    select net.http_get('https://graph.instagram.com/v21.0/' || m.media_id || '/comments?fields=id,text,timestamp,from,username&limit=50&access_token=' || tok) into rid;
    insert into ig_requests (request_id, kind, media_id) values (rid, 'comments', m.media_id);
  end loop;
end $$;

-- read the answers that came back
create or replace function hartna_process_instagram() returns void
language plpgsql security definer set search_path = public as $$
declare q record; body json; c json;
begin
  for q in select r.request_id, r.kind, r.media_id, h.status_code, h.content
             from ig_requests r join net._http_response h on h.id = r.request_id loop
    begin
      body := q.content::json;
      if q.status_code = 200 then
        if q.kind = 'media' then
          insert into settings values ('ig_media', (select coalesce(json_agg(e->>'id'), '[]'::json)::text from json_array_elements(body->'data') e))
            on conflict (key) do update set value = excluded.value;
        elsif q.kind = 'profile' then
          insert into settings values ('followers', body->>'followers_count') on conflict (key) do update set value = excluded.value;
          insert into settings values ('instagram', lower(body->>'username')) on conflict (key) do update set value = excluded.value;
        elsif q.kind = 'comments' then
          for c in select * from json_array_elements(body->'data') loop
            perform hartna_ingest_comment(c->>'id', coalesce(c->'from'->>'username', c->>'username'), q.media_id, c->>'text', (c->>'timestamp')::timestamptz);
          end loop;
        elsif q.kind = 'refresh' and body->>'access_token' is not null then
          update settings set value = body->>'access_token' where key = 'ig_token';
        end if;
      else
        insert into settings values ('ig_last_error', now() || ' ' || left(q.content, 500)) on conflict (key) do update set value = excluded.value;
      end if;
    exception when others then
      insert into settings values ('ig_last_error', now() || ' ' || sqlerrm) on conflict (key) do update set value = excluded.value;
    end;
    delete from ig_requests where request_id = q.request_id;
  end loop;
  delete from ig_requests where created_at < now() - interval '1 hour';
end $$;

-- long-lived tokens last 60 days: refresh weekly
create or replace function hartna_refresh_token() returns void
language plpgsql security definer set search_path = public as $$
declare tok text := (select value from settings where key = 'ig_token'); rid bigint;
begin
  if tok is null then return; end if;
  select net.http_get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' || tok) into rid;
  insert into ig_requests (request_id, kind) values (rid, 'refresh');
end $$;

-- ---------- permissions ----------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function get_city(), request_code(text), check_code(text, text), my_profile(text),
  update_profile(text, text, int), buy(text, text, text), wear(text, text), list_house(text, bigint, int),
  buy_house(text, bigint), logout(text), admin_add(text, text, text), admin_verify(text, text),
  admin_give(text, text, int) to anon, authenticated;

-- ---------- schedules ----------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('hartna-poll', '*/5 * * * *', 'select hartna_poll_instagram()');
    perform cron.schedule('hartna-process', '* * * * *', 'select hartna_process_instagram()');
    perform cron.schedule('hartna-refresh', '0 4 * * 1', 'select hartna_refresh_token()');
  end if;
end $$;

-- ---------- first residents (the real followers so far) ------------------
select hartna_add_resident('mo_awad0', 'مُحَمَّد عَواد', '2026-11-18 00:00+03');
select hartna_add_resident('fawzi_1_1', 'Fawzi', '2026-11-18 00:00+03');
select hartna_add_resident('mr.kalapres', 'Mohannad Majdi', '2026-11-18 00:00+03');
select hartna_add_resident('fawzi_fmd', 'Fawzi', '2026-11-18 00:00+03');
select hartna_add_resident('futuretechjo', 'فريق التطوع FutureTech', '2026-11-18 00:00+03');
insert into settings values ('instagram', 'whatif_dream') on conflict (key) do nothing;

-- مدينتنا: ربط إنستغرام عن طريق صفحة فيسبوك (Facebook login)

-- send the requests (pg_net is asynchronous)
-- Two ways to connect: settings.ig_api = 'instagram' (Instagram login token, graph.instagram.com)
-- or 'facebook' (Facebook login: a long-lived user token; we find the Page + its Instagram account
-- ourselves and keep the Page token, which does not expire).
create or replace function hartna_poll_instagram() returns void
language plpgsql security definer set search_path = public as $$
declare tok text := (select value from settings where key = 'ig_token');
        mode text := coalesce((select value from settings where key = 'ig_api'), 'instagram');
        base text; me text; t text; rid bigint; m record;
begin
  if tok is null then return; end if;
  if mode = 'facebook' then
    me := (select value from settings where key = 'ig_user_id');
    t := (select value from settings where key = 'ig_page_token');
    if me is null or t is null then
      select net.http_get('https://graph.facebook.com/v21.0/me/accounts?fields=access_token,instagram_business_account%7Bid,username%7D&limit=50&access_token=' || tok) into rid;
      insert into ig_requests (request_id, kind) values (rid, 'accounts');
      return;
    end if;
    base := 'https://graph.facebook.com/v21.0/';
  else
    base := 'https://graph.instagram.com/v21.0/'; me := 'me'; t := tok;
  end if;
  -- recent posts
  select net.http_get(base || me || '/media?fields=id,timestamp&limit=8&access_token=' || t) into rid;
  insert into ig_requests (request_id, kind) values (rid, 'media');
  -- profile: username + follower count
  select net.http_get(base || me || '?fields=username,followers_count&access_token=' || t) into rid;
  insert into ig_requests (request_id, kind) values (rid, 'profile');
  -- comments of the posts we know
  for m in select value as media_id from json_array_elements_text(coalesce((select value from settings where key = 'ig_media'), '[]')::json) loop
    select net.http_get(base || m.media_id || '/comments?fields=id,text,timestamp,from,username&limit=50&access_token=' || t) into rid;
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
        elsif q.kind = 'accounts' then
          -- the first Page that has an Instagram account linked
          select e into c from json_array_elements(body->'data') e where e->'instagram_business_account' is not null limit 1;
          if c is null then
            insert into settings values ('ig_last_error', now() || ' no Facebook Page with a linked Instagram account') on conflict (key) do update set value = excluded.value;
          else
            insert into settings values ('ig_user_id', c->'instagram_business_account'->>'id') on conflict (key) do update set value = excluded.value;
            insert into settings values ('ig_page_token', c->>'access_token') on conflict (key) do update set value = excluded.value;
          end if;
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
  if tok is null or (select value from settings where key = 'ig_api') = 'facebook' then return; end if; -- Page tokens don't expire
  select net.http_get('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' || tok) into rid;
  insert into ig_requests (request_id, kind) values (rid, 'refresh');
end $$;

revoke all on function hartna_poll_instagram(), hartna_process_instagram(), hartna_refresh_token() from public, anon, authenticated;

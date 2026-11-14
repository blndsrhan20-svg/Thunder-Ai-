-- Thunder social layer: posts, follows, likes, comments, stories and notifications.
-- Additive migration. Existing profiles, chats and messages are preserved.

alter table public.profiles
  add column if not exists bio text not null default '' check (char_length(bio) <= 160),
  add column if not exists avatar_path text,
  add column if not exists website text not null default '' check (char_length(website) <= 120);

create table if not exists public.user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint user_follows_not_self check (follower_id <> following_id)
);
create index if not exists user_follows_following_idx on public.user_follows(following_id, created_at desc);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 2200),
  media_path text,
  media_type text not null default 'text' check (media_type in ('text','image','video')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_payload_check check (char_length(trim(caption)) > 0 or media_path is not null)
);
create index if not exists posts_created_idx on public.posts(created_at desc);
create index if not exists posts_user_created_idx on public.posts(user_id, created_at desc);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,user_id)
);
create index if not exists post_likes_user_idx on public.post_likes(user_id,created_at desc);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments(post_id,created_at);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_path text not null,
  media_type text not null default 'image' check (media_type in ('image','video')),
  caption text not null default '' check (char_length(caption) <= 240),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_expiry_check check (expires_at > created_at)
);
create index if not exists stories_active_idx on public.stories(expires_at desc, created_at desc);
create index if not exists stories_user_active_idx on public.stories(user_id, expires_at desc);

create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id,viewer_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('follow','like','comment','story_reply')),
  post_id uuid references public.posts(id) on delete cascade,
  story_id uuid references public.stories(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_not_self check (actor_id is null or actor_id <> recipient_id)
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id,is_read,created_at desc);

alter table public.user_follows enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.notifications enable row level security;

grant select on public.user_follows to authenticated;
grant insert,delete on public.user_follows to authenticated;
grant select,insert,update,delete on public.posts to authenticated;
grant select,insert,delete on public.post_likes to authenticated;
grant select,insert,update,delete on public.post_comments to authenticated;
grant select,insert,delete on public.stories to authenticated;
grant select,insert on public.story_views to authenticated;
grant select,update on public.notifications to authenticated;

drop policy if exists follows_read_authenticated on public.user_follows;
create policy follows_read_authenticated on public.user_follows for select to authenticated using (true);
drop policy if exists follows_insert_self on public.user_follows;
create policy follows_insert_self on public.user_follows for insert to authenticated with check (follower_id=(select auth.uid()) and follower_id<>following_id);
drop policy if exists follows_delete_self on public.user_follows;
create policy follows_delete_self on public.user_follows for delete to authenticated using (follower_id=(select auth.uid()));

drop policy if exists posts_read_authenticated on public.posts;
create policy posts_read_authenticated on public.posts for select to authenticated using (true);
drop policy if exists posts_insert_self on public.posts;
create policy posts_insert_self on public.posts for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists posts_update_self on public.posts;
create policy posts_update_self on public.posts for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists posts_delete_self on public.posts;
create policy posts_delete_self on public.posts for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists post_likes_read_authenticated on public.post_likes;
create policy post_likes_read_authenticated on public.post_likes for select to authenticated using (true);
drop policy if exists post_likes_insert_self on public.post_likes;
create policy post_likes_insert_self on public.post_likes for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists post_likes_delete_self on public.post_likes;
create policy post_likes_delete_self on public.post_likes for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists post_comments_read_authenticated on public.post_comments;
create policy post_comments_read_authenticated on public.post_comments for select to authenticated using (true);
drop policy if exists post_comments_insert_self on public.post_comments;
create policy post_comments_insert_self on public.post_comments for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists post_comments_update_self on public.post_comments;
create policy post_comments_update_self on public.post_comments for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists post_comments_delete_self on public.post_comments;
create policy post_comments_delete_self on public.post_comments for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists stories_read_active on public.stories;
create policy stories_read_active on public.stories for select to authenticated using (expires_at>now());
drop policy if exists stories_insert_self on public.stories;
create policy stories_insert_self on public.stories for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists stories_delete_self on public.stories;
create policy stories_delete_self on public.stories for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists story_views_read_owner_or_self on public.story_views;
create policy story_views_read_owner_or_self on public.story_views for select to authenticated using (
  viewer_id=(select auth.uid()) or exists(select 1 from public.stories s where s.id=story_id and s.user_id=(select auth.uid()))
);
drop policy if exists story_views_insert_self on public.story_views;
create policy story_views_insert_self on public.story_views for insert to authenticated with check (
  viewer_id=(select auth.uid()) and exists(select 1 from public.stories s where s.id=story_id and s.user_id<>(select auth.uid()) and s.expires_at>now())
);

drop policy if exists notifications_read_recipient on public.notifications;
create policy notifications_read_recipient on public.notifications for select to authenticated using (recipient_id=(select auth.uid()));
drop policy if exists notifications_update_recipient on public.notifications;
create policy notifications_update_recipient on public.notifications for update to authenticated using (recipient_id=(select auth.uid())) with check (recipient_id=(select auth.uid()));

-- Private media bucket. Objects are accessible only to signed-in users; app-level
-- paths include the uploader id and are checked against the owning post/story.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('thunder-social-media','thunder-social-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime'])
on conflict (id) do update set public=false,file_size_limit=52428800,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime'];

drop policy if exists thunder_social_media_read on storage.objects;
create policy thunder_social_media_read on storage.objects for select to authenticated
using (bucket_id='thunder-social-media' and (
  exists(select 1 from public.posts p where p.media_path=name)
  or exists(select 1 from public.stories s where s.media_path=name and s.expires_at>now())
  or exists(select 1 from public.profiles p where p.avatar_path=name)
));
drop policy if exists thunder_social_media_insert on storage.objects;
create policy thunder_social_media_insert on storage.objects for insert to authenticated
with check (bucket_id='thunder-social-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists thunder_social_media_delete on storage.objects;
create policy thunder_social_media_delete on storage.objects for delete to authenticated
using (bucket_id='thunder-social-media' and (storage.foldername(name))[1]=(select auth.uid())::text);

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='posts') then
      alter publication supabase_realtime add table public.posts;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='post_likes') then
      alter publication supabase_realtime add table public.post_likes;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='post_comments') then
      alter publication supabase_realtime add table public.post_comments;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stories') then
      alter publication supabase_realtime add table public.stories;
    end if;
  end if;
end $$;


-- Generate notifications only from authenticated user actions already protected by RLS.
create or replace function public.thunder_notify_follow()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.notifications(recipient_id,actor_id,kind)
  values(new.following_id,new.follower_id,'follow')
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.thunder_notify_follow() from public,anon,authenticated;
drop trigger if exists thunder_follow_notification on public.user_follows;
create trigger thunder_follow_notification after insert on public.user_follows
for each row execute function public.thunder_notify_follow();

create or replace function public.thunder_notify_post_like()
returns trigger language plpgsql security definer set search_path=''
as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id from public.posts p where p.id=new.post_id;
  if owner_id is not null and owner_id<>new.user_id then
    insert into public.notifications(recipient_id,actor_id,kind,post_id)
    values(owner_id,new.user_id,'like',new.post_id);
  end if;
  return new;
end;
$$;
revoke all on function public.thunder_notify_post_like() from public,anon,authenticated;
drop trigger if exists thunder_post_like_notification on public.post_likes;
create trigger thunder_post_like_notification after insert on public.post_likes
for each row execute function public.thunder_notify_post_like();

create or replace function public.thunder_notify_comment()
returns trigger language plpgsql security definer set search_path=''
as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id from public.posts p where p.id=new.post_id;
  if owner_id is not null and owner_id<>new.user_id then
    insert into public.notifications(recipient_id,actor_id,kind,post_id,comment_id)
    values(owner_id,new.user_id,'comment',new.post_id,new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.thunder_notify_comment() from public,anon,authenticated;
drop trigger if exists thunder_post_comment_notification on public.post_comments;
create trigger thunder_post_comment_notification after insert on public.post_comments
for each row execute function public.thunder_notify_comment();

-- Match Messenger's permanent-account restriction: anonymous Auth sessions cannot use social features.
do $$
declare t text;
begin
  foreach t in array array['user_follows','posts','post_likes','post_comments','stories','story_views','notifications'] loop
    execute format('drop policy if exists %I on public.%I',t||'_permanent_users_only',t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (((select auth.jwt()->>''is_anonymous''))::boolean is false) with check (((select auth.jwt()->>''is_anonymous''))::boolean is false)',t||'_permanent_users_only',t);
  end loop;
end $$;

drop policy if exists thunder_social_media_permanent_users_only on storage.objects;
create policy thunder_social_media_permanent_users_only on storage.objects as restrictive
for all to authenticated using (
  bucket_id <> 'thunder-social-media' or (((select auth.jwt()->>'is_anonymous'))::boolean is false)
) with check (
  bucket_id <> 'thunder-social-media' or (((select auth.jwt()->>'is_anonymous'))::boolean is false)
);

-- Thunder Messenger v2: private group messaging
-- Additive only: preserves all existing tables, users, conversations and messages.

create table if not exists public.group_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists group_conversations_updated_idx
  on public.group_conversations(updated_at desc);

create table if not exists public.group_members (
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key(group_id,user_id)
);
create index if not exists group_members_user_idx on public.group_members(user_id,joined_at desc);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 4000),
  image_path text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint group_message_has_payload check (char_length(trim(content)) > 0 or image_path is not null)
);
create index if not exists group_messages_group_created_idx
  on public.group_messages(group_id,created_at);

create table if not exists public.group_message_reads (
  message_id uuid not null references public.group_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(message_id,user_id)
);
create index if not exists group_message_reads_user_idx on public.group_message_reads(user_id,read_at desc);

create table if not exists public.group_message_reactions (
  message_id uuid not null references public.group_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','😂','😮','😢','🙏','🔥','🎉')),
  created_at timestamptz not null default now(),
  primary key(message_id,user_id,emoji)
);

create or replace function public.is_thunder_group_member(p_group_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $fn$ select p_user_id=(select auth.uid()) and exists(select 1 from public.group_members gm where gm.group_id=p_group_id and gm.user_id=p_user_id) $fn$;
create or replace function public.is_thunder_group_admin(p_group_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $fn$ select p_user_id=(select auth.uid()) and exists(select 1 from public.group_members gm where gm.group_id=p_group_id and gm.user_id=p_user_id and gm.role in ('owner','admin')) $fn$;
revoke all on function public.is_thunder_group_member(uuid,uuid) from public,anon;
revoke all on function public.is_thunder_group_admin(uuid,uuid) from public,anon;
create or replace function public.is_thunder_group_owner(p_group_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $fn$ select p_user_id=(select auth.uid()) and exists(select 1 from public.group_conversations g where g.id=p_group_id and g.owner_id=p_user_id) $fn$;
revoke all on function public.is_thunder_group_owner(uuid,uuid) from public,anon;
grant execute on function public.is_thunder_group_owner(uuid,uuid) to authenticated;


grant execute on function public.is_thunder_group_member(uuid,uuid) to authenticated;
grant execute on function public.is_thunder_group_admin(uuid,uuid) to authenticated;

alter table public.group_conversations enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;
alter table public.group_message_reads enable row level security;
alter table public.group_message_reactions enable row level security;

grant select,insert,update,delete on public.group_conversations to authenticated;
grant select,insert,delete on public.group_members to authenticated;
grant select,insert,update,delete on public.group_messages to authenticated;
grant select,insert on public.group_message_reads to authenticated;
grant select,insert,delete on public.group_message_reactions to authenticated;

drop policy if exists group_conversations_member_read on public.group_conversations;
create policy group_conversations_member_read on public.group_conversations
for select to authenticated using (public.is_thunder_group_member(id,(select auth.uid())));
drop policy if exists group_conversations_owner_create on public.group_conversations;
create policy group_conversations_owner_create on public.group_conversations
for insert to authenticated with check (owner_id=(select auth.uid()));
drop policy if exists group_conversations_admin_update on public.group_conversations;
create policy group_conversations_admin_update on public.group_conversations
for update to authenticated
using (public.is_thunder_group_admin(id,(select auth.uid())))
with check (public.is_thunder_group_admin(id,(select auth.uid())));
drop policy if exists group_conversations_owner_delete on public.group_conversations;
create policy group_conversations_owner_delete on public.group_conversations
for delete to authenticated using (owner_id=(select auth.uid()));

drop policy if exists group_members_member_read on public.group_members;
create policy group_members_member_read on public.group_members
for select to authenticated using (public.is_thunder_group_member(group_members.group_id,(select auth.uid())));
drop policy if exists group_members_admin_add on public.group_members;
create policy group_members_admin_add on public.group_members
for insert to authenticated with check (public.is_thunder_group_owner(group_members.group_id,(select auth.uid())) or public.is_thunder_group_admin(group_members.group_id,(select auth.uid())));
drop policy if exists group_members_admin_or_self_remove on public.group_members;
create policy group_members_admin_or_self_remove on public.group_members
for delete to authenticated using (
  (user_id=(select auth.uid()) and role <> 'owner')
  or public.is_thunder_group_admin(group_members.group_id,(select auth.uid()))
);

drop policy if exists group_messages_member_read on public.group_messages;
create policy group_messages_member_read on public.group_messages
for select to authenticated using (public.is_thunder_group_member(group_messages.group_id,(select auth.uid())));
drop policy if exists group_messages_member_send on public.group_messages;
create policy group_messages_member_send on public.group_messages
for insert to authenticated with check (
  sender_id=(select auth.uid()) and public.is_thunder_group_member(group_messages.group_id,(select auth.uid()))
);
drop policy if exists group_messages_sender_edit on public.group_messages;
create policy group_messages_sender_edit on public.group_messages
for update to authenticated using (sender_id=(select auth.uid()) and public.is_thunder_group_member(group_messages.group_id,(select auth.uid())))
with check (sender_id=(select auth.uid()) and public.is_thunder_group_member(group_messages.group_id,(select auth.uid())));
drop policy if exists group_messages_sender_delete on public.group_messages;
create policy group_messages_sender_delete on public.group_messages
for delete to authenticated using (sender_id=(select auth.uid()) and public.is_thunder_group_member(group_messages.group_id,(select auth.uid())));

drop policy if exists group_message_reads_member_read on public.group_message_reads;
create policy group_message_reads_member_read on public.group_message_reads
for select to authenticated using (exists (select 1 from public.group_messages m where m.id=group_message_reads.message_id and public.is_thunder_group_member(m.group_id,(select auth.uid()))));
drop policy if exists group_message_reads_self_insert on public.group_message_reads;
create policy group_message_reads_self_insert on public.group_message_reads
for insert to authenticated with check (
  user_id=(select auth.uid()) and exists (select 1 from public.group_messages m where m.id=group_message_reads.message_id and public.is_thunder_group_member(m.group_id,(select auth.uid())))
);

drop policy if exists group_reactions_member_read on public.group_message_reactions;
create policy group_reactions_member_read on public.group_message_reactions
for select to authenticated using (exists (select 1 from public.group_messages m where m.id=group_message_reactions.message_id and public.is_thunder_group_member(m.group_id,(select auth.uid()))));
drop policy if exists group_reactions_self_insert on public.group_message_reactions;
create policy group_reactions_self_insert on public.group_message_reactions
for insert to authenticated with check (
  user_id=(select auth.uid()) and exists (select 1 from public.group_messages m where m.id=group_message_reactions.message_id and public.is_thunder_group_member(m.group_id,(select auth.uid())))
);
drop policy if exists group_reactions_self_delete on public.group_message_reactions;
create policy group_reactions_self_delete on public.group_message_reactions
for delete to authenticated using (user_id=(select auth.uid()));

create or replace function public.touch_thunder_group_updated_at()
returns trigger language plpgsql security definer set search_path=''
as $body$
begin
  update public.group_conversations set updated_at=now() where id=new.group_id;
  return new;
end;
$;
revoke all on function public.touch_thunder_group_updated_at() from public,anon,authenticated;
drop trigger if exists thunder_group_message_touch on public.group_messages;
create trigger thunder_group_message_touch after insert on public.group_messages
for each row execute function public.touch_thunder_group_updated_at();


-- Prevent anonymous Supabase Auth sessions from using Messenger group features.
do $do$
declare t text;
begin
  foreach t in array array['group_conversations','group_members','group_messages','group_message_reads','group_message_reactions'] loop
    execute format('drop policy if exists %I on public.%I',t||'_permanent_users_only',t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (((select auth.jwt()->>''is_anonymous''))::boolean is false) with check (((select auth.jwt()->>''is_anonymous''))::boolean is false)',t||'_permanent_users_only',t);
  end loop;
end $do$;
drop policy if exists thunder_chat_images_permanent_users_only on storage.objects;
create policy thunder_chat_images_permanent_users_only on storage.objects as restrictive
for all to authenticated using (
  bucket_id <> 'thunder-chat-images' or (((select auth.jwt()->>'is_anonymous'))::boolean is false)
) with check (
  bucket_id <> 'thunder-chat-images' or (((select auth.jwt()->>'is_anonymous'))::boolean is false)
);

-- Extend the existing private chat image bucket policies to cover group members.
drop policy if exists thunder_chat_images_read_member on storage.objects;
create policy thunder_chat_images_read_member on storage.objects
for select to authenticated using (
  bucket_id='thunder-chat-images' and (
    (storage.foldername(name))[1]='community'
    or exists(select 1 from public.direct_conversations c
      where c.id::text=(storage.foldername(name))[1]
      and (select auth.uid()) in (c.member_one,c.member_two))
    or exists(select 1 from public.group_members gm
      where gm.group_id::text=(storage.foldername(name))[1]
      and gm.user_id=(select auth.uid()))
  )
);
drop policy if exists thunder_chat_images_insert_member on storage.objects;
create policy thunder_chat_images_insert_member on storage.objects
for insert to authenticated with check (
  bucket_id='thunder-chat-images' and (storage.foldername(name))[2]=(select auth.uid())::text
  and (
    ((storage.foldername(name))[1]='community')
    or exists(select 1 from public.direct_conversations c
      where c.id::text=(storage.foldername(name))[1]
      and (select auth.uid()) in (c.member_one,c.member_two))
    or exists(select 1 from public.group_members gm
      where gm.group_id::text=(storage.foldername(name))[1]
      and gm.user_id=(select auth.uid()))
  )
);

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='group_messages') then
      alter publication supabase_realtime add table public.group_messages;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='group_message_reactions') then
      alter publication supabase_realtime add table public.group_message_reactions;
    end if;
  end if;
end $$;

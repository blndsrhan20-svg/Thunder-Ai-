-- Instagram-style private messaging for Thunder AI
create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  member_one uuid not null references auth.users(id) on delete cascade,
  member_two uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint direct_conversations_distinct_members check (member_one <> member_two),
  constraint direct_conversations_pair_unique unique (member_one, member_two)
);
create index if not exists direct_conversations_member_one_idx on public.direct_conversations(member_one,last_message_at desc);
create index if not exists direct_conversations_member_two_idx on public.direct_conversations(member_two,last_message_at desc);
alter table public.direct_conversations enable row level security;
grant select, insert, update on public.direct_conversations to authenticated;
drop policy if exists direct_conversations_read_member on public.direct_conversations;
create policy direct_conversations_read_member on public.direct_conversations for select to authenticated
using ((select auth.uid()) in (member_one,member_two));
drop policy if exists direct_conversations_create_member on public.direct_conversations;
create policy direct_conversations_create_member on public.direct_conversations for insert to authenticated
with check ((select auth.uid()) in (member_one,member_two));
drop policy if exists direct_conversations_update_member on public.direct_conversations;
create policy direct_conversations_update_member on public.direct_conversations for update to authenticated
using ((select auth.uid()) in (member_one,member_two))
with check ((select auth.uid()) in (member_one,member_two));

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 4000),
  image_path text,
  created_at timestamptz not null default now(),
  constraint direct_message_has_content check (char_length(trim(content)) > 0 or image_path is not null)
);
create index if not exists direct_messages_conversation_created_idx on public.direct_messages(conversation_id,created_at);
alter table public.direct_messages enable row level security;
grant select,insert,delete on public.direct_messages to authenticated;
drop policy if exists direct_messages_read_member on public.direct_messages;
create policy direct_messages_read_member on public.direct_messages for select to authenticated
using (exists(select 1 from public.direct_conversations c where c.id=conversation_id and (select auth.uid()) in (c.member_one,c.member_two)));
drop policy if exists direct_messages_send_member on public.direct_messages;
create policy direct_messages_send_member on public.direct_messages for insert to authenticated
with check (sender_id=(select auth.uid()) and exists(select 1 from public.direct_conversations c where c.id=conversation_id and (select auth.uid()) in (c.member_one,c.member_two)));
drop policy if exists direct_messages_delete_own on public.direct_messages;
create policy direct_messages_delete_own on public.direct_messages for delete to authenticated
using (sender_id=(select auth.uid()) and exists(select 1 from public.direct_conversations c where c.id=conversation_id and (select auth.uid()) in (c.member_one,c.member_two)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('thunder-chat-images','thunder-chat-images',false,10485760,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists thunder_chat_images_read_member on storage.objects;
create policy thunder_chat_images_read_member on storage.objects for select to authenticated
using (bucket_id='thunder-chat-images' and exists (
  select 1 from public.direct_conversations c
  where c.id::text=(storage.foldername(name))[1]
    and (select auth.uid()) in (c.member_one,c.member_two)
));
drop policy if exists thunder_chat_images_insert_member on storage.objects;
create policy thunder_chat_images_insert_member on storage.objects for insert to authenticated
with check (bucket_id='thunder-chat-images' and exists (
  select 1 from public.direct_conversations c
  where c.id::text=(storage.foldername(name))[1]
    and (select auth.uid()) in (c.member_one,c.member_two)
));
drop policy if exists thunder_chat_images_delete_own on storage.objects;
create policy thunder_chat_images_delete_own on storage.objects for delete to authenticated
using (bucket_id='thunder-chat-images' and owner_id=(select auth.uid())::text);

do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='direct_messages') then
   alter publication supabase_realtime add table public.direct_messages;
  end if;
 end if;
end $$;

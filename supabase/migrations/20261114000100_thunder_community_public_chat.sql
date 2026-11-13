-- Thunder Community: public chat MVP
create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null check (char_length(trim(sender_name)) between 1 and 40),
  content text not null check (char_length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists community_messages_created_at_idx
  on public.community_messages (created_at desc);
create index if not exists community_messages_user_created_idx
  on public.community_messages (user_id, created_at desc);

alter table public.community_messages enable row level security;
grant select, insert, delete on public.community_messages to authenticated;

drop policy if exists community_messages_read_signed_in on public.community_messages;
create policy community_messages_read_signed_in
  on public.community_messages for select to authenticated using (true);

drop policy if exists community_messages_insert_own on public.community_messages;
create policy community_messages_insert_own
  on public.community_messages for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists community_messages_delete_own on public.community_messages;
create policy community_messages_delete_own
  on public.community_messages for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.enforce_community_message_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account record;
begin
  select u.email, u.raw_user_meta_data into account
  from auth.users u
  where u.id = new.user_id;

  if not found then
    raise exception 'Invalid sender account';
  end if;

  new.sender_name := left(trim(coalesce(
    account.raw_user_meta_data ->> 'display_name',
    split_part(account.email, '@', 1),
    'عضو ثاندر'
  )), 40);

  if char_length(trim(new.content)) not between 1 and 1000 then
    raise exception 'Message must contain 1 to 1000 characters';
  end if;
  if exists (
    select 1 from public.community_messages m
    where m.user_id = new.user_id
      and m.created_at > now() - interval '1200 milliseconds'
  ) then
    raise exception 'Please wait before sending another message';
  end if;
  return new;
end;
$$;

drop trigger if exists community_message_guard on public.community_messages;
create trigger community_message_guard
  before insert on public.community_messages
  for each row execute function public.enforce_community_message_rules();

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.community_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 3 and 300),
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);
alter table public.community_reports enable row level security;
grant insert, select on public.community_reports to authenticated;

drop policy if exists community_reports_insert_own on public.community_reports;
create policy community_reports_insert_own
  on public.community_reports for insert to authenticated
  with check ((select auth.uid()) = reporter_id);

drop policy if exists community_reports_read_own on public.community_reports;
create policy community_reports_read_own
  on public.community_reports for select to authenticated
  using ((select auth.uid()) = reporter_id);

-- Add only the new community table; preserve the existing publication and its tables.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'community_messages'
     ) then
    alter publication supabase_realtime add table public.community_messages;
  end if;
end $$;

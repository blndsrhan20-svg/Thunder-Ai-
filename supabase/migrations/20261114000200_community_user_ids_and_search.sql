-- Thunder Community: stable eight-digit member IDs and member lookup
create sequence if not exists public.community_user_code_seq
  as bigint start with 10000000 minvalue 10000000 maxvalue 99999999 no cycle;

alter table public.profiles
  add column if not exists user_code text;

select setval(
  'public.community_user_code_seq',
  coalesce((select max(user_code::bigint) from public.profiles where user_code ~ '^[0-9]{8}$'), 9999999) + 1,
  false
);

alter table public.profiles
  alter column user_code set default lpad(nextval('public.community_user_code_seq')::text, 8, '0');

update public.profiles
set user_code = lpad(nextval('public.community_user_code_seq')::text, 8, '0')
where user_code is null;

alter table public.profiles
  alter column user_code set not null;

alter table public.profiles
  drop constraint if exists profiles_user_code_format;
alter table public.profiles
  add constraint profiles_user_code_format
  check (user_code ~ '^[0-9]{8}$');

create unique index if not exists profiles_user_code_unique
  on public.profiles(user_code);

-- Signed-in members can find public profile fields; private account data remains hidden.
drop policy if exists profiles_search_signed_in on public.profiles;
create policy profiles_search_signed_in
  on public.profiles for select to authenticated
  using (true);

-- Store the public ID on each community post for fast display without exposing auth data.
alter table public.community_messages
  add column if not exists sender_code text;

create or replace function public.enforce_community_message_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row record;
begin
  select p.display_name, p.user_code into profile_row
  from public.profiles p
  where p.id = new.user_id;

  if not found then
    raise exception 'Community profile not found';
  end if;

  new.sender_name := left(trim(coalesce(profile_row.display_name, 'عضو ثاندر')), 40);
  new.sender_code := profile_row.user_code;

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

-- Backfill IDs on earlier public messages where possible.
update public.community_messages m
set sender_code = p.user_code,
    sender_name = left(coalesce(p.display_name, m.sender_name), 40)
from public.profiles p
where p.id = m.user_id
  and m.sender_code is null;

create index if not exists profiles_display_name_search_idx
  on public.profiles using gin (to_tsvector('simple', coalesce(display_name, '')));

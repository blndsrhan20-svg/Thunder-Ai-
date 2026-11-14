-- Thunder direct-message receipts, reactions and edit metadata.
-- Additive only; no existing messages are deleted or rewritten.

alter table public.direct_messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public.direct_message_reads (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(message_id,user_id)
);
create index if not exists direct_message_reads_user_idx on public.direct_message_reads(user_id,read_at desc);

create table if not exists public.direct_message_reactions (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','😂','😮','😢','🙏','🔥','🎉')),
  created_at timestamptz not null default now(),
  primary key(message_id,user_id,emoji)
);
create index if not exists direct_message_reactions_message_idx on public.direct_message_reactions(message_id,created_at);

alter table public.direct_message_reads enable row level security;
alter table public.direct_message_reactions enable row level security;

grant select,insert on public.direct_message_reads to authenticated;
grant select,insert,delete on public.direct_message_reactions to authenticated;
grant select on public.direct_messages to authenticated;
grant update,delete on public.direct_messages to authenticated;

drop policy if exists direct_message_reads_member_read on public.direct_message_reads;
create policy direct_message_reads_member_read on public.direct_message_reads for select to authenticated
using (exists(
  select 1 from public.direct_messages m
  join public.direct_conversations c on c.id=m.conversation_id
  where m.id=direct_message_reads.message_id and (select auth.uid()) in (c.member_one,c.member_two)
));
drop policy if exists direct_message_reads_self_insert on public.direct_message_reads;
create policy direct_message_reads_self_insert on public.direct_message_reads for insert to authenticated
with check (
  user_id=(select auth.uid()) and exists(
    select 1 from public.direct_messages m
    join public.direct_conversations c on c.id=m.conversation_id
    where m.id=direct_message_reads.message_id and (select auth.uid()) in (c.member_one,c.member_two)
      and m.sender_id<>(select auth.uid())
  )
);

drop policy if exists direct_message_reactions_member_read on public.direct_message_reactions;
create policy direct_message_reactions_member_read on public.direct_message_reactions for select to authenticated
using (exists(
  select 1 from public.direct_messages m
  join public.direct_conversations c on c.id=m.conversation_id
  where m.id=direct_message_reactions.message_id and (select auth.uid()) in (c.member_one,c.member_two)
));
drop policy if exists direct_message_reactions_self_insert on public.direct_message_reactions;
create policy direct_message_reactions_self_insert on public.direct_message_reactions for insert to authenticated
with check (
  user_id=(select auth.uid()) and exists(
    select 1 from public.direct_messages m
    join public.direct_conversations c on c.id=m.conversation_id
    where m.id=direct_message_reactions.message_id and (select auth.uid()) in (c.member_one,c.member_two)
  )
);
drop policy if exists direct_message_reactions_self_delete on public.direct_message_reactions;
create policy direct_message_reactions_self_delete on public.direct_message_reactions for delete to authenticated
using (user_id=(select auth.uid()));

drop policy if exists direct_messages_sender_update on public.direct_messages;
create policy direct_messages_sender_update on public.direct_messages for update to authenticated
using (sender_id=(select auth.uid()) and exists(
  select 1 from public.direct_conversations c
  where c.id=direct_messages.conversation_id and (select auth.uid()) in (c.member_one,c.member_two)
))
with check (sender_id=(select auth.uid()) and exists(
  select 1 from public.direct_conversations c
  where c.id=direct_messages.conversation_id and (select auth.uid()) in (c.member_one,c.member_two)
));

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='direct_message_reactions') then
      alter publication supabase_realtime add table public.direct_message_reactions;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='direct_message_reads') then
      alter publication supabase_realtime add table public.direct_message_reads;
    end if;
  end if;
end $$;

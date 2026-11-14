-- Message notifications for direct chats and groups.
-- Requires group messaging migration 20261114000500 and social notifications migration 20261114000700.

alter table public.notifications
  add column if not exists conversation_id uuid references public.direct_conversations(id) on delete cascade,
  add column if not exists group_id uuid references public.group_conversations(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('follow','like','comment','story_reply','message','group_message'));

create or replace function public.thunder_notify_direct_message()
returns trigger language plpgsql security definer set search_path=''
as $$
declare recipient uuid;
begin
  select case when c.member_one=new.sender_id then c.member_two else c.member_one end
    into recipient
  from public.direct_conversations c where c.id=new.conversation_id;
  if recipient is not null then
    insert into public.notifications(recipient_id,actor_id,kind,conversation_id)
    values(recipient,new.sender_id,'message',new.conversation_id);
  end if;
  return new;
end;
$$;
revoke all on function public.thunder_notify_direct_message() from public,anon,authenticated;
drop trigger if exists thunder_direct_message_notification on public.direct_messages;
create trigger thunder_direct_message_notification after insert on public.direct_messages
for each row execute function public.thunder_notify_direct_message();

create or replace function public.thunder_notify_group_message()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.notifications(recipient_id,actor_id,kind,group_id)
  select gm.user_id,new.sender_id,'group_message',new.group_id
  from public.group_members gm
  where gm.group_id=new.group_id and gm.user_id<>new.sender_id;
  return new;
end;
$$;
revoke all on function public.thunder_notify_group_message() from public,anon,authenticated;
drop trigger if exists thunder_group_message_notification on public.group_messages;
create trigger thunder_group_message_notification after insert on public.group_messages
for each row execute function public.thunder_notify_group_message();

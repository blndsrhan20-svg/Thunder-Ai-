alter table public.community_messages add column if not exists image_path text;
drop policy if exists thunder_chat_images_read_member on storage.objects;
create policy thunder_chat_images_read_member on storage.objects for select to authenticated
using (bucket_id='thunder-chat-images' and (
  (storage.foldername(name))[1]='community'
  or exists(select 1 from public.direct_conversations c where c.id::text=(storage.foldername(name))[1] and (select auth.uid()) in (c.member_one,c.member_two))
));
drop policy if exists thunder_chat_images_insert_member on storage.objects;
create policy thunder_chat_images_insert_member on storage.objects for insert to authenticated
with check (bucket_id='thunder-chat-images' and (
  ((storage.foldername(name))[1]='community' and (storage.foldername(name))[2]=(select auth.uid())::text)
  or exists(select 1 from public.direct_conversations c where c.id::text=(storage.foldername(name))[1] and (select auth.uid()) in (c.member_one,c.member_two))
));
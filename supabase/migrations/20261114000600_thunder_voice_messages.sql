-- Thunder Messenger v2: private voice messages (additive only)
alter table public.direct_messages add column if not exists audio_path text;
alter table public.direct_messages drop constraint if exists direct_message_has_content;
alter table public.direct_messages drop constraint if exists direct_message_has_payload;
alter table public.direct_messages add constraint direct_message_has_payload
  check (char_length(trim(content)) > 0 or image_path is not null or audio_path is not null);

alter table public.group_messages add column if not exists audio_path text;
alter table public.group_messages drop constraint if exists group_message_has_payload;
alter table public.group_messages add constraint group_message_has_payload
  check (char_length(trim(content)) > 0 or image_path is not null or audio_path is not null);

update storage.buckets
set file_size_limit=26214400,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif','audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac']
where id='thunder-chat-images';

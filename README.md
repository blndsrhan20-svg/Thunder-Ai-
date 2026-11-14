# Thunder Messenger v2

A clean modular rebuild of the Messenger client.

## Implemented in this branch
- Supabase email/password authentication with persistent sessions.
- Profile lookup/edit and member search by username or Thunder ID.
- One-to-one conversations, realtime private messages, and private image sharing.
- Group creation, member selection, group messages, group image sharing, reaction toggles, and group read markers, and recorded voice messages in direct and group chats.
- Responsive Arabic RTL interface designed for iPhone and desktop.
- PWA manifest, icons, and conservative service worker that does not cache Supabase API traffic.

## Schema changes
The additive migrations are `20261114000500_thunder_group_messaging.sql` and `20261114000600_thunder_voice_messages.sql`. They add group conversations, memberships, group messages, read markers, reactions, voice-message columns, membership-aware RLS, and private storage policy extensions. They do not drop or rewrite existing tables.

**The migration has not been applied to the live Supabase project.** Group features will remain unavailable on the deployed site until the migration is reviewed and applied. No Railway deployment was performed.

## Still planned / not yet implemented
- Non-image file attachments.
- One-to-one and group audio/video calls (WebRTC signaling and TURN relay still need implementation and configuration).
- Channels, message edit/delete UI, delivery/read indicators for direct messages, push notifications, blocking/reporting, and moderation tools.
- End-to-end tests with two or more real accounts and iPhone Safari/PWA verification.

Do not describe unimplemented or untested features as production-ready. Existing users, profiles, private conversations, messages, AI-related database tables, and existing migration history are intentionally preserved.

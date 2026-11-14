# Thunder Messenger v2

A clean modular rebuild of the Messenger client.

Implemented in this slice: Supabase email/password auth, profile lookup/edit, one-to-one chats using existing tables, realtime message refresh, chat search, and responsive iPhone-first layout.

Not yet implemented: group conversations, channels, voice/video calls, message reactions, editing/deletion, delivery/read receipts, push notifications, and attachment upload. Do not describe these as working yet.

Existing Supabase data, tables, auth users, and migration history are intentionally preserved. No production migration or Railway deployment is performed by this branch. Verify auth/profile RLS, direct-message RLS, realtime, and two-account flows before release.
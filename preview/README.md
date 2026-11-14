# Thunder Messenger — Phase 1 UI Preview

This folder contains an isolated, static UI prototype for reviewing the first Messenger screen.

## Open the preview
Open `messenger-preview.html` in a browser. It is responsive for desktop and mobile.

## Prototype behavior
- Switch between sample conversations.
- Search the sample conversation list.
- Filter all, unread, and online sample chats.
- Type and append local demo messages.

## Important boundaries
- All names and messages in this preview are fictional demo data.
- The composer does not send messages to Supabase or any server.
- No authentication, database, storage, Realtime, or production code is changed.
- The existing `index.html`, `server.js`, Supabase schema, users, secrets, and Railway deployment are untouched.
- This is a visual/interaction prototype only, not a functioning messaging service.

## Next review step
After approval, the next phase can replace the current AI-first screen in a separate proposed change, integrating the existing direct-message tables only after their exact schema, RLS policies, and user/profile relationships are fully reviewed.

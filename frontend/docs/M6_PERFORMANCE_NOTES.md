# M6 performance notes

- Route-level lazy loading remains enabled for all major pages.
- Catalog, profile, and consultation avatars use native lazy loading and asynchronous decoding.
- The Zoom Meeting SDK remains intentionally isolated behind the existing lazy `ZoomMeetingPage` route. Its large chunk warning is expected because the official SDK is required for production meetings; replacing or manually splitting vendor internals is deferred as a high-risk change.

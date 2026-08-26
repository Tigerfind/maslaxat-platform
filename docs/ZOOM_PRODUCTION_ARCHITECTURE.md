# Zoom production architecture

## SDK choice

The web client uses the official `@zoom/meetingsdk` 6.2.0 package. Desktop browsers use Meeting SDK Component View on the isolated `/consultations/zoom/:id` route. Mobile/tablet use the official Meeting SDK Client View; unsupported browsers can open the official Zoom web client/application through an authenticated, short-lived backend access request.

Video SDK is intentionally not used: it creates Video SDK sessions and cannot join normal Zoom Meetings created by the Zoom Meetings REST API.

Official references:

- https://developers.zoom.us/docs/meeting-sdk/web/component-view/
- https://developers.zoom.us/docs/meeting-sdk/auth/
- https://developers.zoom.us/docs/meeting-sdk/web/browser-support/
- https://developers.zoom.us/docs/api/webhooks/
- https://developers.zoom.us/docs/api/rate-limits/

## Trust boundaries

- OAuth access/refresh tokens, meeting passcodes and provider URLs are encrypted at rest.
- The frontend never receives OAuth credentials or a client `start_url`.
- `POST /api/zoom/consultations/:id/sdk-access` authenticates the participant, payment, consultation state and join window before issuing a two-hour Meeting SDK JWT.
- Client receives SDK role `0`. Lawyer receives role `1` and a freshly fetched ZAK.
- `POST /api/zoom/consultations/:id/access` is an official Zoom client fallback and returns the host URL only to the assigned lawyer.
- Responses containing join authorization use `no-store`, `no-cache` and `no-referrer` headers.

## Scheduling policy

- Allowed booked durations: 30, 60 or 90 minutes.
- Timestamps are stored as UTC `scheduled_start_at` and `scheduled_end_at`.
- `schedule_timezone` stores the IANA timezone used to interpret the civil slot.
- The entire interval must fit the lawyer's schedule.
- A configurable buffer, `BOOKING_BUFFER_MINUTES` (default 10), is enforced before and after every blocking consultation for both lawyer and client.
- Booking and rescheduling acquire sorted PostgreSQL advisory locks for both participants, then recheck availability inside the transaction.
- Lobby opens 10 minutes before the booked start. The interval has a five-minute grace period and never moves the next booking.

## Lifecycle and recovery

`Consultation.lifecycleStatus` uses:

`pending_payment`, `confirmed`, `meeting_creating`, `ready`, `waiting_for_lawyer`, `waiting_for_client`, `in_progress`, `completed`, `cancelled`, `failed`, `rescheduled`, `no_show_client`, `no_show_lawyer`.

The legacy `status` remains during migration because payment, escrow and shipped clients depend on it. Only the server changes lifecycle state.

`ConsultationMeeting` is a durable operation queue. It records desired state, pending create/update/cancel/end operation, version, idempotency key, attempts, next attempt, lease and safe provider error. Workers use leases, bounded exponential backoff and reconciliation. Create retries search for the consultation marker before issuing another POST.

Meeting creation requires accepted booking and confirmed payment, except free consultations. Cancellation dominates in-flight creation. Provider DELETE 404 is idempotent success.

## Attendance, timer and no-show

- Signed Zoom events provide authoritative first join, conversation start, leave and meeting end times.
- Opaque HMAC `customerKey` identifies client/lawyer without sending internal IDs or personal data to logs.
- The browser calculates a clock offset from `serverNow`; backend remains authoritative.
- Warnings appear at 10, 5 and 1 minute and at scheduled end.
- Five minutes after scheduled end the backend requests Zoom to end the meeting and asks the client to confirm delivery. Webhooks never release escrow.
- After `CONSULTATION_NO_SHOW_MINUTES` (default 15), server state becomes `no_show_client` or `no_show_lawyer`. A lawyer no-show never counts as successfully delivered.
- Refund finalization waits `ZOOM_ATTENDANCE_SETTLE_MINUTES` (default 10) after grace and rechecks lifecycle under a database lock, allowing delayed Zoom attendance events to arrive first.

## Webhooks

Supported events:

- `meeting.started`
- `meeting.ended`
- `participant.joined`
- `participant.left`
- `app_deauthorized`
- `endpoint.url_validation`

The raw body signature and timestamp are checked before persistence. Request IDs are unique and payload digests prevent conflicting replay. The handler stores minimal non-content data, replies `204`, and processes asynchronously. Failed/queued events are recovered by reconciliation. Out-of-order terminal events cannot reopen cancelled or ended meetings.

Recording is disabled with `auto_recording: none`. No recording API or consent flow is enabled.

## Browser policy

- Component View: current and previous two desktop versions of Chrome, Edge, Firefox and Safari.
- Mobile/tablet: official Meeting SDK Client View because Component View is not supported there; official Zoom web client/application remains the fallback.
- Android Firefox is unsupported by Zoom.
- Browser E2EE is not supported by Meeting SDK Web.
- Safari has feature restrictions including virtual backgrounds; screen-share audio is primarily Chrome/Edge.

## Recovery runbook

1. Check `/api/health/ready` and `/api/system/capabilities`.
2. Open admin consultation diagnostics and inspect lifecycle, meeting operation, attempts and safe error.
3. If OAuth is `reauth_required`, ask the lawyer to reconnect Zoom.
4. For a transient failed meeting, use the admin retry action; do not manually create an unrelated meeting.
5. If Zoom is unavailable near start, use the official external client fallback or reschedule.
6. Never paste host URLs, ZAK, SDK signatures or OAuth tokens into tickets/logs.
7. Alert on failed meeting rate, retry backlog, join failures, reconnect growth and webhook rejection growth.

## Production checklist

1. Configure Zoom General App OAuth and enable Meeting SDK Embed.
2. Complete Zoom Marketplace review for meetings hosted by connected external lawyer accounts.
3. Set `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_REDIRECT_URI`, `ZOOM_WEBHOOK_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY`, `MEETING_PARTICIPANT_SECRET`, and `ZOOM_MEETING_SDK_ENABLED=1`.
4. Subscribe to meeting and participant webhook events and point them to `/api/zoom/webhook`.
5. Apply migrations `20260829000000` through `20260829000004` after a verified backup and resolve any fail-closed legacy scheduling audit errors before retrying.
6. Verify CSP allows documented Zoom HTTPS, WebSocket, worker and WASM resources.
7. Test one free and one sandbox-paid 30/60/90 minute booking on staging.
8. Test host/client role separation, cancellation, reschedule, duplicate webhook and deauthorization.
9. Verify no token, passcode, full URL or legal question appears in logs or monitoring.

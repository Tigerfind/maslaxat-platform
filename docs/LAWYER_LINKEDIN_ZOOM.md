# Lawyer profile, LinkedIn and Zoom

## Environment

LinkedIn OIDC:

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://API_DOMAIN/api/auth/linkedin/callback
```

Requested scopes are limited to `openid profile email`. LinkedIn data is used only for identity; profile scraping is not performed.

Zoom OAuth:

```env
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_REDIRECT_URI=https://API_DOMAIN/api/zoom/oauth/callback
ZOOM_WEBHOOK_SECRET=
OAUTH_TOKEN_ENCRYPTION_KEY=
```

Generate the encryption key once with `openssl rand -base64 32`. Changing it invalidates stored Zoom tokens. Configure the Zoom webhook URL as `https://API_DOMAIN/api/zoom/webhook` and subscribe to meeting lifecycle and app deauthorization events.

## API

LinkedIn:

- `POST /api/auth/linkedin/start`
- `GET /api/auth/linkedin/callback`
- `POST /api/auth/linkedin/complete`
- `GET /api/auth/linkedin/link/status`
- `POST /api/auth/linkedin/link/start`
- `POST /api/auth/linkedin/link/complete`

Professional profile:

- `GET /api/lawyer/profile`
- `PATCH /api/lawyer/profile/draft`
- `GET /api/lawyer/profile/preview`
- `POST /api/lawyer/verification/submit`
- `GET /api/lawyers/:id/available-slots`

Zoom:

- `GET /api/zoom/status`
- `POST /api/zoom/oauth/authorize`
- `GET /api/zoom/oauth/callback`
- `DELETE /api/zoom/connection`
- `POST /api/zoom/consultations/:id/access`
- `POST /api/zoom/webhook`

Manual Zoom disconnect is rejected while future Zoom consultations exist. Remote app deauthorization switches affected consultations to the platform video provider and notifies both parties. Zoom webhook events update meeting state but do not release escrow; payment release remains in the participant-authorized consultation completion flow.

## Database rollout

Apply in order:

1. `20260825000000-lawyer-resume-linkedin-zoom.js`
2. `20260825000001-finalize-lawyer-resume-zoom.js`
3. `20260825000002-unique-active-zoom-user.js`

The second migration validates legacy `preferred_time`, backfills UTC schedule windows, and migrates legacy education/certificate JSON into normalized tables. Always run `npm run db:audit` after migration.

## Verification

```bash
cd backend/api
npm test -- --runInBand
npm run db:migrate:status
npm run db:audit

cd ../../frontend
npm run lint
npm test -- --run
npm run build
npm run e2e
```

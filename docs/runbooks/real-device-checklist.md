# Real-device Pilot Checklist

Automated browser emulation is not real-device evidence. Record every row with device model, OS version, browser version, network, UTC timestamp, release SHA, tester, result, and artifact link. Use synthetic accounts and non-sensitive files only.

## Environment

```text
release_sha:
staging_frontend_url:
staging_backend_url:
turn_service:
vapid_configured: yes/no
tester:
started_at_utc:
completed_at_utc:
```

The environment must be isolated staging with HTTPS, private staging PostgreSQL/Redis/R2, sandbox providers, and no production user data.

## Device Matrix

| Device | OS | Browser | Wi-Fi | Mobile network | Result | Evidence |
|---|---|---|---|---|---|---|
| iPhone |  | Safari |  |  |  |  |
| Low-end Android |  | Chrome |  |  |  |  |
| Windows PC |  | Chrome |  | n/a |  |  |
| Windows PC |  | Edge |  | n/a |  |  |
| macOS |  | Safari |  | n/a |  |  |

## Core Flows

Run on every applicable device:

- [ ] Register and sign in with a synthetic account.
- [ ] Complete 2FA where eligible and switch client/lawyer mode.
- [ ] Navigate dashboard, catalog, profile, consultations, chat, and notifications.
- [ ] Upload, preview, download, and delete a small synthetic PDF or image.
- [ ] Deny camera/microphone permission; verify a controlled error and recovery path.
- [ ] Grant permissions and join a consultation call.
- [ ] Background the app, resume it, and verify session/call state.
- [ ] Switch network or briefly disconnect; verify reconnect without duplicate messages/actions.
- [ ] Log out; verify push unbind, local unsubscribe, cache purge, and no prior-user screen after the next login.
- [ ] Sign in as a different synthetic user; verify no previous user data appears.

## Required Call Pairs

| Pair | Network path | Direct/TURN observed | Denied permission | Background/resume | Reconnect | Result | Evidence |
|---|---|---|---|---|---|---|---|
| iPhone Safari to Android Chrome | Wi-Fi to Wi-Fi |  |  |  |  |  |  |
| iPhone Safari to Android Chrome | mobile to Wi-Fi |  |  |  |  |  |  |
| macOS Safari to Windows Chrome | Wi-Fi to Wi-Fi |  |  |  |  |  |  |

At least one required pair must prove TURN relay using provider/server evidence. A successful same-network P2P call does not satisfy the TURN gate.

## PWA And Update

- [ ] Install from iPhone Safari and Android Chrome where supported.
- [ ] Launch standalone and verify icon, theme, start URL, and navigation.
- [ ] Confirm `sw.js`, `index.html`, and `manifest.json` are revalidated.
- [ ] Confirm hashed `/static` assets use long immutable caching.
- [ ] Load once online, go offline, and verify only the public app shell is available.
- [ ] Confirm API, Socket.io, auth, documents, private blobs, exports, errors, opaque responses, and private/no-store responses are unavailable from cache.
- [ ] Deploy an approved staging update; verify one controlled reload and the new release.
- [ ] Log out offline/online and verify MaslaXat caches are purged without deadlock.

## Push

Run only when staging VAPID is configured:

- [ ] Subscribe from settings and record browser permission state.
- [ ] Receive a notification with the tab foregrounded and backgrounded.
- [ ] Receive a notification with the PWA closed where the platform supports it.
- [ ] Click the notification and verify same-origin safe navigation.
- [ ] Log out and verify the old session endpoint no longer receives notifications.
- [ ] Log in as a second user and verify subscription rebind without cross-user delivery.

If VAPID, platform support, or physical devices are unavailable, mark the row blocked rather than passed.

## Accessibility And Mobile

- [ ] Complete keyboard-only login, mode switch, booking, chat, and document actions on desktop.
- [ ] Screen reader announces form labels, errors, dialogs, status changes, and sponsored labels.
- [ ] Focus remains visible and returns correctly after dialogs.
- [ ] Controls remain usable at 200% zoom and at narrow mobile widths.
- [ ] Touch targets are at least 44 by 44 CSS pixels.
- [ ] Reduced-motion preference removes nonessential motion.
- [ ] Portrait and landscape layouts do not hide primary actions.

## Verdict

```text
result: pass/blocked/fail
failed_rows:
blocked_rows:
turn_verified: yes/no
push_verified: yes/no/not-configured
pwa_update_verified: yes/no
reviewer:
reviewed_at_utc:
follow_up_issues:
```

The real-device gate passes only when all required rows pass and an independent reviewer approves the evidence.

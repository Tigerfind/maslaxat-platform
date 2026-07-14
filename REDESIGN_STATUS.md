# eMaslaXat — Liquid-Glass re-skin (branch `redesign/glass-ui`)

Re-skin of the existing full-stack app to the ClaudeDesign mockups (ClientApp / LawyerApp).
Plumbing (routing, Redux, services, Socket.io, backend) kept; only page presentation swapped.
Mobile (MobileApp.dc.html) → **separate Expo/React Native app, deferred** (decided with user).

Status: **all web screens ported 1:1, app compiles (warnings only), served at :3000.**

## Foundation (shared, built once)
| File | Purpose |
|---|---|
| `frontend/src/styles/glass.css` | Light+dark CSS-var tokens + all 24 keyframes + glass utilities |
| `frontend/src/components/GlassKit/AmbientBackground.js` | Orbs + pointer-reactive gloss backdrop |
| `frontend/src/components/GlassKit/GlassShell.js` | Sidebar + topbar + working dark toggle + language + notifications (client & lawyer nav) |

## Screens re-skinned (what / where / data)
| Screen | File | Wired to |
|---|---|---|
| Client Dashboard | pages/Dashboard/DashboardPageGlass.js | dashboard.getStats / getUpcomingConsultations / subscription.getMy |
| AI Chat | pages/AI/AIChatPageGlass.js | aiChat.* + lawyers.searchLawyers (+Web Speech voice) |
| Lawyers Catalog | pages/Lawyers/LawyersPageGlass.js | lawyers.searchLawyers + favorites.* + BookingModal |
| Lawyer Profile | pages/Lawyers/LawyerProfilePage.js | lawyers.getLawyerDetails (**mock removed**) |
| Consultations | pages/Consultations/ConsultationsPageGlass.js | consultations.* + RatingDialog + leaveReview |
| Documents | pages/Documents/DocumentsPageGlass.js | documents.* (upload + AI-check dialog) |
| Portfolio/Досье | pages/Client/PortfolioPage.js | Promise.all(documents, consultations, aiChat, favorites, stats) |
| My Profile | pages/Profile/ProfilePageGlass.js | users/profile + password (**mock stats/activity removed**) |
| Settings | pages/Settings/SettingsPageGlass.js | localStorage + **dark theme wired to shell** + i18n |
| Support | pages/Help/HelpPage.js | FAQ + ticket form (stub) |
| Booking Modal | components/BookingModal.js | 4-step wizard → lawyers.bookConsultation |
| Video Call | pages/Consultations/VideoCallPage.js | socket.io + simple-peer (unchanged logic) |
| Consultation Chat | pages/Consultations/ChatPage.js | socket.io chat (unchanged logic) |
| Lawyer Dashboard | pages/Lawyer/LawyerDashboardGlass.js | lawyerService.dashboard.* + requests accept/reject |
| Lawyer Schedule | pages/Lawyer/LawyerSchedulePage.js | schedule.getSchedule / confirm / reject |
| Lawyer Reviews | pages/Lawyer/LawyerReviewsPage.js | reviews.* (**mock + teal neumorphism removed**) |
| Lawyer Profile Edit | pages/Lawyer/LawyerProfileEditPage.js | GET/PUT /lawyer/profile |
| Onboarding Wizard | components/Lawyer/OnboardingWizard.js | PUT /lawyer/profile (4 steps) |

## Backend — DONE
- `routes/lawyer-portal.js`: reviews list + recent now return `reply` / `repliedAt` / `helpful` (replies & like-counts persist across reload).

## Backend — GAPS to fill (surfaced by the re-skin), prioritized
1. **Lawyer metrics** — `LawyerProfile` has no `responseTime`/`successRate`. Catalog "Успех %" and profile "response time" are hidden until added (model column + `/lawyers` + `/lawyers/:id` response, dashboard "Скорость ответа" as `avgResponseHours`).
2. **User.address** — Profile page shows an Адрес field with no column; edits silently dropped. Add `address` to User + include in `PUT /users/profile`.
3. **Support tickets** — `POST /api/support` (category, subject, message, userId) + model; Help form is client-side only.
4. **Settings persistence** — no endpoint; email/push/privacy/display prefs live only in localStorage. Add `UserSettings` (or JSONB on User) + `GET/PUT /api/users/settings`.
5. **Booking → payment** — BookingModal STEP 3 is a UI stub; wire to Payme create/checkout (routes exist) so booking creates `payment_pending` → Payme → `pending`.
6. **Structured AI answer** — `ai/chat/message` returns plain text; design wants `{ steps[], laws[], caution, matchedLawyer }`. Enrich prompt+response for the rich AI card.
7. **Documents** — add file download route; persist top-level `aiScore` + `category` for list rendering without opening `aiAnalysis`.
8. **Consultation extras** — `progress`/`nextStep` (Портфолио dossier), reliable `preferredTime`/`type`, and consultation `rating` flag (to hide "Оценить" after review).
9. **AI conversations** — return `preview`/`lastMessage` + `category` per conversation (Досье AI cards).
10. **Reschedule / Income Analytics** — new endpoints for the mobile app phase (reschedule consultation; lawyer per-period income breakdown).
11. **Known dupes to unify** (from earlier audit) — single booking path (`payment_pending`) and single completion path (escrow settlement in one place); unify notification type names.

## Not yet visually verified
App compiles and is served, but the **backend was down** (no Postgres/Redis/seed), so authed screens
were not rendered/screenshotted. To verify: start `backend/api` (`npm run dev`), seed, log in
(client@maslaxat.uz / client123, lawyer1@maslaxat.uz / lawyer123) → open :3000.

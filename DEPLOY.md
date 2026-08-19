# Деплой MaslaXat — чеклист и где взять ключи

Пошаговая инструкция для подготовки запуска. A1 migration foundation локально реализован и
reviewer-approved: baseline + sync-era bridge, true-empty PostgreSQL 16 и representative sync-era
drills проходят без production `sync()`. Это не является production migration/deploy evidence.
Wave 1 payment safety/TOP и A3 final-gate preparation подтверждены только локально; staging,
Payme sandbox observation, cutover, deploy и production verification не выполнены. Ключи сами по
себе не заменяют gates.

Session A consolidated status: **A1** migration-safe Docker/CI is locally implemented;
**A2** encrypted immutable backup/restore controls are locally implemented; **A3** payment proof is
locally implemented with active mode still refused; **A4** authorization proof is locally implemented
with `compatibility` still the default and no role removal. External blockers remain Docker/Railway
execution, sanitized staging data, real providers/backups, protected approvals, cutovers and smoke.
The A1-A4 task contracts are `APPROVED_LOCAL`, but the Session A release gate remains red: the strict
frontend build has 47 warnings and the frontend audit retains 31 findings. Those frontend-owned
warning and Router/CRA remediation tracks are deferred to Session B and are not waived.

## Wave 1: текущий статус

- Реализовано и локально проверено: fail-closed Payme webhook, typed payments,
  double-entry ledger, prepayment consultation flow, TOP campaigns/catalog/admin UI.
- Локальная основа: true-empty/representative migrations и migration-safe CI готовы; A3 добавляет
  pinned multi-scenario inventory, continuity/semantic proof, exact reconciliation, schema-v4
  manifest и разделённые collection/reconciliation/signing environments. Актуальная evidence:
  `.superpowers/sdd/session-a-release-foundation/agent-f-a3-payme-implementation.md`.
- Последний чистый полный backend rerun прошёл: 101 suites, 1201/1201 tests. Предыдущие
  `production-jobs.test.js` failures больше не являются текущим blocker; точная история первого
  нестабильного прогона и чистого повторного прогона сохранена в Session A ledger.
- `PAYMENT_V2_MODE=active` намеренно отклоняется кодом. Использовать `legacy`; `shadow`
  разрешён только с полным Payme tuple. Evidence signing keys приложению не передаются:
  защищённый offline Ed25519 workflow описан в `docs/runbooks/payme-cutover.md`.
- Не выполнено: production migration/deploy, отдельный staging, реальные Payme credentials,
  provider-native sandbox scenarios или 24-часовой подписанный shadow-evidence manifest,
  reconciliation на representative sanitized staging data, explicit cutover approval,
  deploy и production transaction/refund smoke.

## P2 multi-role/LinkedIn: текущий статус

- Реализовано и локально проверено: additive member/admin capabilities, compatibility dual guards,
  explicit client/lawyer/admin mode, MFA-bound operations, private LinkedIn PDF import, versioned
  review/confirm, public provenance labels, and frontend mode/import flows.
- Task 10 evidence: load-safe backend command
  `npm --prefix backend/api test -- --runInBand --testTimeout=120000` passed 59 suites/692 tests;
  the earlier default-timeout run had one load-related `resetDb` hook timeout. Frontend Task 10
  evidence remains 29 suites/141 tests, lint 0 errors/46 warnings, production build exit 0;
  security matrix 28 suites/294 tests; migration matrix 6 suites/42 tests across P2 migrations
  `20260821000000`-`00004`. FixRound1 reran backend only. Report:
  `.superpowers/sdd/2026-08-13-multirole-linkedin-implementation/task-10-report.md`.
- Compatibility only: keep legacy `role`, capability dual checks, and mismatch telemetry. P2.4
  capability-only cutover requires an approved compatibility deployment and at least 24 hours of
  zero-mismatch staging telemetry. No role-removal migration is part of P2.
- Session A A4 preparation adds fail-closed `AUTHORIZATION_MODE=compatibility|capability_only`, a
  versioned HTTP/socket/catalog inventory, durable privacy-safe denominators/canaries, strict signed
  Ed25519 evidence, three distinct protected approvals, and stop-before-change workflows. The
  default and currently approved authority remains `compatibility`; no staging evidence, approval,
  activation, deploy, or production verification is claimed. Runbook: `docs/runbooks/capability-cutover.md`.
- A4 FixRound1 hardens the local gate with mechanically collected exact mounted surfaces, recent
  observation-end freshness, Railway/build-derived runtime identity and canonical config digest,
  provider/GitHub run provenance, capability-authoritative admin lawyer targets, independent raw
  aggregate rebuild, actual-mode shadow events, uncached socket revalidation, shell-safe workflows,
  and envelope-carried approval key IDs. Compatibility remains default; external gates are unchanged.
- Not staging/deploy ready: Linux parser-container runtime smoke remains externally blocked,
  retention processors require verified production scheduling, no real R2/provider was used, and no commit,
  push, deploy, production migration, or production smoke is claimed.

---

## 1. Где взять каждый ключ

| Ключ (в `.env`) | Где получить | Без него |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | AI работает в фолбэк-режиме (шаблонные ответы по законам РУз), не реальный Claude |
| `PAYME_KEY` + `PAYME_MERCHANT_ID` | merchant.payme.uz (регистрация мерчанта) | Реальная оплата отключена; в dev доступен тест-платёж (`/payments/simulate`) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Любой SMTP: Gmail App Password, SendGrid, Mailgun, Yandex 360 | В production отправка безопасно пропускается; Ethereal используется только в dev |
| `SMS_PROVIDER` + `ESKIZ_EMAIL/ESKIZ_PASSWORD` (или `PLAYMOBILE_*`) | Eskiz.uz (регистрация → API-пароль) или Play Mobile | Вход/регистрация по телефону: в dev код возвращается в ответе (`devCode`), в проде `phone/request` вернёт ошибку — реальная SMS не уходит |
| `JWT_SECRET` | Сгенерировать: `openssl rand -base64 48` | Слабый секрет = взлом токенов. **Обязательно заменить** |
| `DB_PASSWORD` | Пароль вашей PostgreSQL | — |
| `TURN_URL/USERNAME/CREDENTIAL` | Свой coturn-сервер или платный TURN (Twilio, Metered) | Видео нестабильно за реальными NAT (сейчас публичный демо-TURN) |
| `SOCKET_REDIS` | `1` только при деплое на >1 инстанс | На одном инстансе не нужен (оставить `0`) |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | Сгенерировать один раз: `node -e "console.log(require('web-push').generateVAPIDKeys())"` (приватный — секрет) | Web-push отключён (уведомления только в приложении + socket); кнопка «Push на устройство» скрыта |
| `GOOGLE_CLIENT_ID` | console.cloud.google.com → OAuth client (Web) | Кнопка «Войти через Google» скрыта |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` | @BotFather (токен бота и его username без `@`) | Кнопка «Войти через Telegram» скрыта |

> ⚠️ **Никогда не коммить `.env`** — он уже в `.gitignore`. Реальные секреты вносите
> через хранилище платформы (Railway Variables, Docker secrets, env хостинга).

---

## 2. Подготовка `.env`

```bash
cd backend/api
cp .env.example .env
```

Заполнить (минимум для production-запуска; процесс завершится до импорта интеграций при ошибке):
- `NODE_ENV=production`
- `JWT_SECRET` — неплейсхолдерный, минимум 32 символа (`openssl rand -base64 48`)
- non-empty `DATABASE_URL` обязателен для production/Railway predeploy; `DB_*` не является fallback
  release gate и допустим только для отдельных local/non-production команд
- `REDIS_URL` — `redis://` или `rediss://`
- `CORS_ORIGINS` и `FRONTEND_URL` — HTTPS; wildcard запрещён, frontend обязан быть в CORS
- `R2_ACCOUNT_ID` (32 hex), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRIVATE_BUCKET`
- `R2_AI_TEMP_LIFECYCLE_DAYS=1`; this validates the application contract but does not create the
  provider rule. In Cloudflare R2, manually add a lifecycle rule for prefix `ai-temp/` that expires
  objects after 1 day. The durable cleanup worker remains the primary 15-minute cleanup path.
- `STORAGE_MIGRATION_CHECKPOINT_KEY` — отдельный стабильный секрет минимум 32 символа. Не менять
  между resumable-запусками: HMAC checkpoint привязан к environment, non-secret DB fingerprint,
  canonical upload root, domain order, mode, snapshot и keyset cursor.
- разные `CATALOG_CURSOR_SECRET` и `CATALOG_ATTRIBUTION_SECRET` (минимум 32 символа,
  также отличны от `JWT_SECRET`)
- `AUTHORIZATION_MODE=compatibility`
- полный provider runtime identity tuple: `RAILWAY_GIT_COMMIT_SHA` (ровно 40 hex),
  `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_SERVICE_ID`
- predeploy backup gate: canonical base64 `MIGRATION_BACKUP_EVIDENCE_B64`,
  `MIGRATION_BACKUP_EVIDENCE_SIGNATURE_B64`, `MIGRATION_BACKUP_EVIDENCE_PUBLIC_KEY_B64`, exact
  `MIGRATION_BACKUP_EVIDENCE_KEY_ID`, and `MIGRATION_BACKUP_MAX_AGE_SECONDS=3600`. Evidence must
  come from the fresh successful independent backup finalizer for this exact
  `RAILWAY_GIT_COMMIT_SHA`; local/test evidence is invalid.
- `AUTHORIZATION_METADATA_TOKEN` — отдельный неплейсхолдерный секрет минимум 32 символа
- `AUTHORIZATION_EVIDENCE_*` и три approval public-key tuples оставить пустыми/absent до отдельно
  одобренного capability-only cutover; private signing keys никогда не передавать приложению
- Ключи из таблицы выше по мере готовности

Опциональные провайдеры (`PAYME_*`, `SMTP_*`, `TURN_*`, SMS, `VAPID_*`,
Telegram) заполняются только полными tuples. Каноническое имя SMTP-пароля: `SMTP_PASS`;
`SMTP_PASSWORD` намеренно отклоняется. `SMTP_REQUIRE_TLS=true` допустим только с
`SMTP_SECURE=false`; file/URL access в Nodemailer всегда отключён.

LinkedIn PDF import (обязательно до включения):
- `R2_ACCOUNT_ID` (ровно 32 hex), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_PRIVATE_BUCKET`; bucket private, scoped credentials, без `r2.dev`/public URL.
- Рабочий `REDIS_URL`; production rate limiting fail-closed. Не включать
  `PROFILE_IMPORT_RATE_LIMIT_FALLBACK` в production.
- `PDF_IMPORT_AVAILABILITY_FILE` и `CLAMAV_DEFINITION_DIRECTORY` обычно оставляются Docker defaults.
  Import доступен только после успешного signed-definition freshness check и startup sandbox
  self-test; при любой ошибке API возвращает 503, небезопасного fallback нет.

Object storage operations (report-only unless the command explicitly says otherwise):

```bash
npm run storage:migrate -- --batch=100
npm run storage:migrate -- --apply --batch=100
npm run storage:reconcile
npm run storage:reconcile -- --schedule-deletion
npm run storage:cleanup -- --limit=25
npm run storage:cleanup -- --apply --confirm-object-deletion --limit=25
```

`storage:cleanup` is dry-run by default. Physical deletion is possible only with `--apply` and either
`--confirm-object-deletion` or the exact one-command environment confirmation
`CONFIRM_OBJECT_CLEANUP=DELETE`; never persist that confirmation in service configuration.

Migration checkpoints are signed and atomically replaced. Each run uses a fixed `snapshotAt` and
`createdAt,id` keyset; rows inserted after the snapshot are intentionally handled by the next run.
Migration and reconciliation never delete local sources. Reconciliation classifies a path without an
R2 key as blocking `legacyOnly`; a retained path beside a verified R2 key is rollback information and
does not block readiness. Keep `/uploads` and local fallback through the approved rollback window.
Only after a clean staging reconciliation, explicit storage cutover approval, and expiry of that
rollback window may a separate reviewed operation remove retained local files. This Task 2 tooling
does not perform that removal. `--schedule-deletion` only creates idempotent R2 cleanup tasks.

Фронтенд (`frontend/.env` или переменные сборки):
- `REACT_APP_API_URL=https://ВАШ_ДОМЕН/api`

---

## 3. Что переключится автоматически при добавлении ключей

Код уже написан так, что не нужно менять логику — только `.env`:

- **AI**: как только задан `ANTHROPIC_API_KEY` — ответы идут через реальный Claude (иначе фолбэк).
- **Оплата подписок, консультаций и TOP**: при пригодном `PAYME_KEY` webhook принимает
  авторизованные вызовы, а `/payments/simulate` в production заблокирован. Это не включает
  V2 cutover: до внешней staging-проверки держать `PAYMENT_V2_MODE=shadow`; `active` отклоняется.
- **Почта**: при полном `SMTP_*` tuple письма идут реальным провайдером. Без него production
  возвращает `skipped`, а Ethereal создаётся только в dev; адресаты, токены и preview credentials
  не логируются.
- **SMS**: при `SMS_PROVIDER=eskiz` + `ESKIZ_EMAIL/ESKIZ_PASSWORD` (или `PLAYMOBILE_*`) коды
  входа по телефону уходят реальной SMS; логин-токен Eskiz кэшируется и сам обновляется при 401.
  Без ключей — `devCode` в dev, ошибка в проде (код не «отправляется» вслепую).
- **Масштаб сокетов**: `SOCKET_REDIS=1` включает Redis-адаптер (уведомления/чат между инстансами).
- **Web-push**: при заданных `VAPID_*` появляется тумблер «Push на это устройство» и уведомления
  доставляются даже при закрытой вкладке (иначе фича просто скрыта, ничего не ломается).
- **Соц-вход**: `GOOGLE_CLIENT_ID` показывает кнопку Google; `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_BOT_USERNAME` — кнопку Telegram. Прод-примечание: для внешних скриптов в CSP фронта
  разрешить `accounts.google.com` и `telegram.org`.

---

## 4. База данных и миграции

Текущий A1 production-контракт миграций:
- Docker image содержит `migrations/`, `.sequelizerc` и локальный production `sequelize-cli`.
- Railway до старта вызывает `npm run db:predeploy`. До соединения local fail-closed validator
  проверяет подпись, freshness, release SHA и exact packaged target plan. Затем одна PostgreSQL
  advisory-session lock охватывает live `pg_control_system()`/`SequelizeMeta` verification и весь
  CLI-процесс. Actual `DATABASE_URL` system identifier обязан совпасть с signed backup cluster hash;
  operator-provided cluster ID не используется.
- Migration role получает только существующие migration/lock privileges, `SELECT` на
  `SequelizeMeta` и возможность выполнить `pg_control_system()`. Ошибка/запрет identity query
  останавливает predeploy до запуска `sequelize-cli`.
- Production startup выполняет authenticate и exact packaged/applied `SequelizeMeta` assertion.
  Pending, unknown, duplicate или отсутствующее состояние останавливает старт; production schema
  никогда не создаётся и не изменяется через model sync.
- Development сохраняет явный `sync({ alter: true })`; это не production bootstrap.
- True-empty PostgreSQL 16 и representative sync-era migration/rerun drills локально проходят.
  Это не заменяет Docker-capable CI, Railway predeploy и sanitized staging-copy evidence.

Операторские команды (Node.js `>=22.18.0 <23`, reviewed runtime 22.18.0):

```bash
cd backend/api
npm run db:predeploy        # production: signed backup gate, then advisory-locked migration
npm run db:migrate:locked   # internal stage; do not bypass db:predeploy in production
npm run db:migrate:status   # что применено / ожидает
```

Порядок: подготовить PostgreSQL/Redis и переменные, выполнить locked predeploy, затем запустить тот
же image. `/api/ready` становится 200 только после exact migration assertion и dependency probes.
Не выполнять production `db:sync`, destructive undo или ручное создание таблиц.

P2 migration/rollback contract:
- `20260821000000`-`00004` additive и monotonic; `down` намеренно не удаляет capability,
  MFA/import/audit/cleanup данные. Для rollback приложения вернуть предыдущий совместимый release,
  не выполнять destructive schema undo.
- Legacy `role` сохраняется один rollback release и остаётся частью dual guard. Удалять его можно
  только отдельной миграцией после P2.4 observation/cutover и явного согласования.
- Локальные legacy/partial/rerun drills не заменяют true-empty baseline или sanitized staging copy.

Retention contract:
- Неподтверждённый import raw/draft: максимум 24 часа.
- Подтверждённый raw/draft: максимум 30 дней или до admin review, что раньше.
- Content-free audit metadata: максимум 90 дней; payload/PDF text запрещены схемой.
- Parse, import retention, audit retention и object cleanup processors экспортированы, но не
  запланированы. До P3 distributed leader/queue ownership, мониторинга и alerting pilot заблокирован.

---

## 5. Деплой

### Вариант A — Railway

Backend `backend/api/railway.json` использует digest-pinned Dockerfile, fail-closed
`preDeployCommand: npm run db:predeploy`, `npm start` и readiness `/api/ready`. Backend runtime
range: Node.js `>=22.18.0 <23`; image pin: 22.18.0. БД читает `DATABASE_URL`, Redis — `REDIS_URL`.
Frontend остаётся отдельным static-build сервисом по `frontend/railway.json`.

Пошагово (аккаунт на railway.app + этот GitHub-репозиторий подключён):

1. **New Project → Deploy from GitHub repo** → выбрать `maslaxat-platform`.
2. **Плагины:** в проекте → *New* → **Database → PostgreSQL**; ещё раз → **Database → Redis**.
   Railway сам заводит переменные `DATABASE_URL` и `REDIS_URL`.
3. **Сервис Backend:** созданный из репозитория сервис → *Settings*:
   - **Root Directory:** `backend/api`
   - Railway подхватит Docker `railway.json`, locked predeploy, `npm start` и `/api/ready`.
   - **Variables** (вкладка Variables у backend-сервиса):
     - `DATABASE_URL` → *Reference* на переменную из Postgres-плагина
     - `REDIS_URL` → *Reference* на Redis-плагин
     - `DB_SSL=1` (если Postgres-плагин требует TLS — обычно для внешнего подключения; для
       приватной сети Railway можно не ставить)
      - `NODE_ENV=production`
      - provider identity: `RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_SERVICE_ID`
      - `AUTHORIZATION_MODE=compatibility` и отдельный `AUTHORIZATION_METADATA_TOKEN` (>=32)
      - `AUTHORIZATION_EVIDENCE_*` и три approval public-key tuples оставить пустыми до отдельно
        одобренного capability-only cutover; private signing keys приложению не передавать
     - `JWT_SECRET` = сгенерировать (`openssl rand -base64 48`)
     - `CORS_ORIGINS` и `FRONTEND_URL` = публичный URL фронта (заполнить после шага 4)
     - ключи по мере готовности: `ANTHROPIC_API_KEY`, `PAYME_*`, `SMTP_*`, `SMS_PROVIDER`+`ESKIZ_*`, `TURN_*`
4. **Сервис Frontend:** в проекте → *New* → **GitHub Repo** (тот же репозиторий) → *Settings*:
   - **Root Directory:** `frontend`
   - Railway подхватит `frontend/railway.json` (build + `serve`).
   - **Variables:** `REACT_APP_API_URL` = `https://<домен backend-сервиса>/api`
     (домен backend виден в его *Settings → Networking → Public Domain*; при необходимости
     нажать *Generate Domain*).
5. **Сгенерировать домены** обоим сервисам (*Settings → Networking → Generate Domain*), затем
   вернуться в backend и вписать в `CORS_ORIGINS`/`FRONTEND_URL` публичный домен фронта.
6. **Redeploy** обоих сервисов (кнопка *Deploy* или пуш в `main` — Railway деплоит автоматически).

> Порядок: Postgres/Redis → Docker build → advisory-locked predeploy → exact startup assertion →
> `/api/ready`. При отказе проверять migration state, DB/Redis/R2 probes и обязательные production
> identity/config tuples; не обходить отказ schema sync-ом.

**Грабли, которые уже учтены/важно знать:**
- **Backend builder:** только Dockerfile из `backend/api`; не заменять его другим builder, иначе
  migrations/CLI и pinned PDF sandbox toolchain не будут доказаны. Frontend использует свой
  отдельный static build/serve контракт.
- **Загрузки (аватары/документы) исчезнут при редеплое** — диск Railway эфемерный. Реши так:
  backend-сервис → *Volumes* → добавь том с Mount path, напр. `/data`, и поставь переменную
  `UPLOAD_DIR=/data/uploads`. Без этого сайт работает, но загруженные файлы не переживут деплой.
- **`REACT_APP_API_URL` вшивается при СБОРКЕ фронта** — если поменял его после первого билда,
  обязательно передеплой фронт (иначе он стучится на localhost).

### Вариант B — Docker Compose (есть `docker-compose.yml` + Dockerfiles)
```bash
# в корне репозитория
docker compose up -d --build
```
Проверить, что переменные окружения проброшены в контейнеры (не хардкодить в образ).

---

## 6. Пост-деплой проверка

- [ ] `GET /api/live` → 200 и dependency-aware `GET /api/ready` → 200
- [ ] Регистрация + вход работают (JWT выдаётся)
- [ ] AI-чат отвечает (реальный Claude, если ключ задан)
- [ ] Тест-оплата **недоступна** в проде (`/payments/simulate` → 403)
- [ ] Письмо сброса пароля реально приходит на почту
- [ ] Видеозвонок между двумя устройствами соединяется (нужен TURN)
- [ ] Уведомления приходят мгновенно (socket), не только по опросу
- [ ] На телефоне сайт предлагает «Установить приложение» (PWA-иконки на месте)
- [ ] 2FA: юрист/админ включает в Настройках (QR + код), при след. входе спрашивает код
- [ ] Web-push (если `VAPID_*`): тумблер в Настройках подписывает, уведомление приходит при закрытой вкладке
- [ ] Соц-вход (если ключи заданы): кнопки Google/Telegram видны и логинят
- [ ] Ошибки не показывают stack trace клиенту (скрыт при `NODE_ENV=production`)
- [ ] Sentry: отдельные backend/frontend проекты, sanitized staging event, release/source maps и alerts проверены по `docs/runbooks/sentry-observability.md`

---

## 7. Blocking release gates

Запуск запрещён, пока не закрыты все внешние release gates:

- Успешный Docker-capable image build и nonroot/native parser smoke для reviewed image.
- Railway advisory-locked predeploy и startup точного reviewed image.
- Sanitized staging migration с exact `SequelizeMeta` assertion и успешным readiness `/api/ready`.

Локальные тесты и `APPROVED_LOCAL` task contracts не заменяют эти evidence.

## 8. Что ещё в BACKLOG (не блокирует запуск)

- Реальный вывод денег юристом (сейчас тест-флоу; нужен Payme Transfer/выплаты).
- Внешняя настройка Sentry (проекты/DSN/upload token/alerts/staging evidence); код и privacy boundary готовы, см. `docs/runbooks/sentry-observability.md`.

# Деплой MaslaXat — чеклист и где взять ключи

Пошаговая инструкция для запуска в продакшене. Фазы 1–6 кода готовы; осталось
подставить реальные ключи и развернуть. Всё, что помечено «тест-режим», работает
и без ключей, но по-настоящему включается только с ними.

---

## 1. Где взять каждый ключ

| Ключ (в `.env`) | Где получить | Без него |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | AI работает в фолбэк-режиме (шаблонные ответы по законам РУз), не реальный Claude |
| `PAYME_KEY` + `PAYME_MERCHANT_ID` | merchant.payme.uz (регистрация мерчанта) | Реальная оплата отключена; в dev доступен тест-платёж (`/payments/simulate`) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Любой SMTP: Gmail App Password, SendGrid, Mailgun, Yandex 360 | Письма (сброс пароля, верификация) уходят только в тестовый Ethereal (dev), реальные юзеры их не получают |
| `SMS_PROVIDER` + `ESKIZ_EMAIL/ESKIZ_PASSWORD` (или `PLAYMOBILE_*`) | Eskiz.uz (регистрация → API-пароль) или Play Mobile | Вход/регистрация по телефону: в dev код возвращается в ответе (`devCode`), в проде `phone/request` вернёт ошибку — реальная SMS не уходит |
| `JWT_SECRET` | Сгенерировать: `openssl rand -base64 48` | Слабый секрет = взлом токенов. **Обязательно заменить** |
| `DB_PASSWORD` | Пароль вашей PostgreSQL | — |
| `TURN_URL` + `TURN_SECRET` | Свой coturn `use-auth-secret` или платный TURN | Видео нестабильно за реальными NAT. Статические credentials разрешаются только явным `TURN_ALLOW_STATIC=1` |
| `SOCKET_REDIS` | `1` только при деплое на >1 инстанс | На одном инстансе не нужен (оставить `0`) |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | Сгенерировать один раз: `node -e "console.log(require('web-push').generateVAPIDKeys())"` (приватный — секрет) | Web-push отключён (уведомления только в приложении + socket); кнопка «Push на устройство» скрыта |
| `GOOGLE_CLIENT_ID` | console.cloud.google.com → OAuth client (Web) | Кнопка «Войти через Google» скрыта |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` | @BotFather (токен бота и его username без `@`) | Кнопка «Войти через Telegram» скрыта |
| `LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URI` | LinkedIn Developer Portal → OpenID Connect | Регистрация/привязка LinkedIn для юристов скрыта |
| `ZOOM_CLIENT_ID/SECRET/REDIRECT_URI` + `ZOOM_WEBHOOK_SECRET` | Zoom App Marketplace → General OAuth app | Zoom нельзя подключить; WebRTC продолжает работать |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` | Zoom OAuth fail-closed; ключ нельзя менять после подключения аккаунтов |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | sentry.io → Project Settings → Client Keys | Ошибки остаются только в Railway/Winston logs |

> ⚠️ **Никогда не коммить `.env`** — он уже в `.gitignore`. Реальные секреты вносите
> через хранилище платформы (Railway Variables, Docker secrets, env хостинга).

---

## 2. Подготовка `.env`

```bash
cd backend/api
cp .env.example .env
```

Заполнить (минимум для запуска):
- `NODE_ENV=production`
- `JWT_SECRET` — сгенерированный (`openssl rand -base64 48`)
- `DB_*` — доступ к PostgreSQL
- `REDIS_URL` — адрес Redis
- `CORS_ORIGINS` и `FRONTEND_URL` — ваш домен
- Ключи из таблицы выше по мере готовности

Фронтенд (`frontend/.env` или переменные сборки):
- `VITE_API_URL=https://ВАШ_ДОМЕН/api`

---

## 3. Что переключится автоматически при добавлении ключей

Код уже написан так, что не нужно менять логику — только `.env`:

- **AI**: как только задан `ANTHROPIC_API_KEY` — ответы идут через реальный Claude (иначе фолбэк).
- **Оплата подписок и консультаций**: при `PAYME_KEY` тест-платёж отключается, включается
  реальный Payme-webhook. В проде `/payments/simulate` и бесплатная активация подписок
  заблокированы (fail-closed).
- **Почта**: при заданном `SMTP_*` письма идут реальным провайдером вместо Ethereal.
- **SMS**: при `SMS_PROVIDER=eskiz` + `ESKIZ_EMAIL/ESKIZ_PASSWORD` (или `PLAYMOBILE_*`) коды
  входа по телефону уходят реальной SMS; логин-токен Eskiz кэшируется и сам обновляется при 401.
  Без ключей — `devCode` в dev, ошибка в проде (код не «отправляется» вслепую).
- **Масштаб сокетов**: `SOCKET_REDIS=1` включает Redis-адаптер (уведомления/чат между инстансами).
- **Web-push**: при заданных `VAPID_*` появляется тумблер «Push на это устройство» и уведомления
  доставляются даже при закрытой вкладке (иначе фича просто скрыта, ничего не ломается).
- **Соц-вход**: `GOOGLE_CLIENT_ID` показывает кнопку Google; `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_BOT_USERNAME` — кнопку Telegram. Прод-примечание: для внешних скриптов в CSP фронта
  разрешить `accounts.google.com` и `telegram.org`.
- **LinkedIn для юристов**: после настройки OIDC появляется регистрация/привязка LinkedIn.
- **Zoom**: после настройки OAuth юрист подключает свой аккаунт в настройках; webhook URL:
  `https://<backend>/api/zoom/webhook`. Полная настройка и API описаны в
  `docs/LAWYER_LINKEDIN_ZOOM.md`.

---

## 4. База данных и миграции

Схема:
- **dev** — `sync({ alter: true })` (подгоняет схему под модели на лету, удобно).
- **prod** — Railway predeploy запускает forward-only runtime runner, после чего startup gate
  проверяет схему до `sync()`, фоновых jobs и `listen`. Если predeploy или gate падает, новая версия
  не становится active/healthy. `sync()` остаётся без `alter`; изменения схемы — только миграциями.

Production runner не требует `sequelize-cli` (его нет в production dependencies). Docker image содержит
`migrations/`; runner использует установленный `sequelize` и точный anchor
`20260829000005-fix-reminder-column-names.js`. Он рассматривает только `.js`-файлы, лексикографически
идущие после anchor. Текущее production содержит 56 записей `SequelizeMeta`, включая anchor.

Production/runtime команды:

```bash
cd backend/api
npm run db:migrate:runtime:status  # anchor, applied и pending
npm run db:migrate:runtime:check   # exit != 0 и имена, если есть pending
npm run db:migrate:runtime         # advisory lock, повторная проверка, затем up по порядку
```

`up` удерживает PostgreSQL session advisory lock, повторно читает pending после получения lock,
выполняет `migration.up(queryInterface, Sequelize)` по порядку и записывает имя в `SequelizeMeta`
только после успеха. Повторный запуск безопасен и при актуальной схеме ничего не делает.

Runner намеренно fail-closed, если отсутствует каталог миграций, таблица `SequelizeMeta`, файл anchor
или запись anchor в `SequelizeMeta`. Он никогда не создаёт/не stamp-ит baseline и не проигрывает
исторические delta-миграции. Поэтому **чистая база не поддерживается этим runner**: сначала нужен
отдельный проверенный baseline по `docs/DB_BASELINE_PLAN.md`.

Локальные development-команды `db:migrate`, `db:migrate:status` и `db:migrate:undo` по-прежнему
используют `sequelize-cli`; их нельзя использовать как замену production runtime runner.

Порядок обычного обновления существующего production:
1. Сделать резервную копию PostgreSQL.
2. На восстановленном disposable clone выполнить `npm run db:migrate:runtime:status`, затем дважды
   `npm run db:migrate:runtime`; второй запуск обязан быть no-op.
3. Выполнить `NODE_ENV=production npm run db:audit` на clone и проверить `drift`/`unsafeData`.
4. Deploy: Railway автоматически выполнит `node src/scripts/runMigrations.js up` в predeploy.
5. Проверить `/api/health/ready` и `npm run db:migrate:runtime:check`.

Rollback приложения разрешён только на версию, совместимую с уже применённой forward-схемой.
Runtime runner не выполняет `down`. Если миграция не прошла, исправить её/данные и повторить deploy;
если она прошла, но приложение нужно откатить, сначала оценить совместимость и использовать ручной,
проверенный план восстановления. Не удалять записи `SequelizeMeta` и не откатывать DDL вслепую.

Правовая база AI загружается отдельно только из разрешённой выгрузки:
`npm run legal:import -- /path/corpus.json`. Формат и лицензионные ограничения описаны в
`docs/LEGAL_KNOWLEDGE.md`. Пустой корпус не ломает чат, но AI не показывает подтверждённые источники.

Текущая обязательная миграция платежей создаёт уникальный индекс
`payments_provider_transaction_id_unique`. Если в базе уже есть повторяющиеся Payme transaction ID,
миграция остановится без удаления финансовых записей — дубли нужно разобрать вручную.

> Новые изменения схемы вносим миграцией с именем после anchor, а не правкой моделей «на живую».
> Генерировать файл локально можно через `npx sequelize-cli migration:generate --name ...`.

---

## 5. Деплой

### Вариант A — Railway (проще всего, конфиги уже в репозитории)

Готово в репозитории: `backend/api/railway.json` (Dockerfile, migration predeploy, `npm start`,
healthcheck `/api/health`) и `frontend/railway.json` (Vite build → Nginx на `$PORT`).
БД читает `DATABASE_URL` (плагин Railway), Redis — `REDIS_URL`. Backend работает на Node 20,
frontend требует Node 20.19+. Деплой выполняется локальным Railway CLI из каталога каждого сервиса;
`watchPatterns` намеренно отсутствуют, потому что monorepo-пути не существуют внутри local-upload архива.

Пошагово для уже созданного Railway project:

1. **New Project → Deploy from GitHub repo** → выбрать `maslaxat-platform`.
2. **Плагины:** в проекте → *New* → **Database → PostgreSQL**; ещё раз → **Database → Redis**.
   Railway сам заводит переменные `DATABASE_URL` и `REDIS_URL`.
3. **Сервис Backend:** Root Directory и repository Config File Path не задавать: local upload
   выполняется из `backend/api`, где `/railway.json` и Dockerfile лежат в корне архива.
   - **Variables** (вкладка Variables у backend-сервиса):
     - `DATABASE_URL` → *Reference* на переменную из Postgres-плагина
     - `REDIS_URL` → *Reference* на Redis-плагин
     - `DB_SSL=1` (если Postgres-плагин требует TLS — обычно для внешнего подключения; для
       приватной сети Railway можно не ставить)
     - `NODE_ENV=production`
     - `JWT_SECRET` = сгенерировать (`openssl rand -base64 48`)
     - `CORS_ORIGINS` и `FRONTEND_URL` = публичный URL фронта (заполнить после шага 4)
     - ключи по мере готовности: `ANTHROPIC_API_KEY`, `PAYME_*`, `SMTP_*`, `SMS_PROVIDER`+`ESKIZ_*`, `TURN_*`
4. **Сервис Frontend:** local upload выполняется из `frontend`, где Railway автоматически
   подхватывает `/railway.json` и Dockerfile.
    - **Variables:** `VITE_API_URL` = `https://<домен backend-сервиса>/api`
      (домен backend виден в его *Settings → Networking → Public Domain*; при необходимости
      нажать *Generate Domain*).
      Для Railway эта переменная обязательна: frontend и backend работают на разных доменах.
5. **Сгенерировать домены** обоим сервисам (*Settings → Networking → Generate Domain*), затем
   вернуться в backend и вписать в `CORS_ORIGINS`/`FRONTEND_URL` публичный домен фронта.
6. **Deploy** вручную:
   `cd backend/api && railway up --service backend --environment production`, затем
   `cd ../../../frontend && railway up --service frontend --environment production`.

> Backend можно направлять только на подготовленную anchored-базу. На чистой базе predeploy
> намеренно завершится ошибкой до активации deployment. Помимо `DATABASE_URL`/`JWT_SECRET`, при
> ошибке запуска проверяйте runtime migration status; Redis может работать в degraded mode.

**Грабли, которые уже учтены/важно знать:**
- **Билдер:** оба `railway.json` используют Dockerfile. Root Directory каждого сервиса должен
  совпадать с шагами выше; вручную переключать builder на Nixpacks не нужно.
- **Загрузки (аватары/документы) исчезнут при редеплое** — диск Railway эфемерный. Реши так:
  backend-сервис → *Volumes* → добавь том с Mount path, напр. `/data`, и поставь переменную
  `UPLOAD_DIR=/data/uploads`. Без этого сайт работает, но загруженные файлы не переживут деплой.
- **`VITE_API_URL` вшивается при СБОРКЕ фронта** — если поменял его после первого билда,
  обязательно передеплой фронт (иначе он стучится на localhost).

### Вариант B — Docker Compose (есть `docker-compose.yml` + Dockerfiles)
```bash
# в корне репозитория
docker compose up -d --build
```
Проверить, что переменные окружения проброшены в контейнеры (не хардкодить в образ).
Compose-сеть использует `api:3001` и `frontend:3000`; nginx-конфигурация уже настроена на эти имена.

---

## 6. Пост-деплой проверка

- [ ] `GET /api/health` → 200
- [ ] `GET /api/health/ready` → 200, `database: true`; `redis: false` означает degraded mode
- [ ] `GET /api/system/capabilities` соответствует реально заданным ключам и не содержит секретов
- [ ] Перед миграциями создан custom-format backup клиентом той же major-версии PostgreSQL
- [ ] Backup восстановлен в отдельную disposable-БД; совпали число таблиц и ключевые row counts
- [ ] `npm run db:migrate:runtime:check` завершается с кодом 0 и без pending
- [ ] Регистрация + вход работают (JWT выдаётся)
- [ ] AI-чат отвечает (реальный Claude, если ключ задан)
- [ ] Тест-оплата **недоступна** в проде (`/payments/simulate` → 403)
- [ ] Письмо сброса пароля реально приходит на почту
- [ ] Видеозвонок между двумя устройствами соединяется (нужен TURN)
- [ ] Zoom General App: OAuth + Meeting SDK Embed включены, Marketplace review завершён для external lawyer accounts
- [ ] Zoom staging: host role получает ZAK, client role не получает ZAK/start URL; Component View и mobile fallback проверены
- [ ] Zoom webhooks `meeting.started/ended`, `participant.joined/left`, `app_deauthorized` доставляются и видны в admin diagnostics
- [ ] Уведомления приходят мгновенно (socket), не только по опросу
- [ ] На телефоне сайт предлагает «Установить приложение» (PWA-иконки на месте)
- [ ] 2FA: юрист/админ включает в Настройках (QR + код), при след. входе спрашивает код
- [ ] Web-push (если `VAPID_*`): тумблер в Настройках подписывает, уведомление приходит при закрытой вкладке
- [ ] Соц-вход (если ключи заданы): кнопки Google/Telegram видны и логинят
- [ ] Ошибки не показывают stack trace клиенту (скрыт при `NODE_ENV=production`)
- [ ] `RUN_SEED=0`; `ALLOW_PRODUCTION_DEMO_DATA=0` на публичном production

---

## 7. Что ещё в BACKLOG (не блокирует запуск)

- Реальный вывод денег юристом (сейчас тест-флоу; нужен Payme Transfer/выплаты).
- Метрики и alerting поверх подготовленной Sentry-интеграции (нужны DSN и внешний uptime monitor).
- Baseline для чистой БД остаётся отдельной задачей. Runtime runner не создаёт и не stamp-ит его,
  поэтому clean deployment безопасно блокируется. Production сейчас имеет 56 записей
  `SequelizeMeta`; гарантированный runtime anchor — `20260829000005-fix-reminder-column-names.js`.
  Read-only проверка production 18.08.2026 показала 23 таблицы и применённые тогда 32 delta-миграции.
  Обнаруженные 3376 исторически продублированных индексов и 9 пустых `problems` исправлены
  в maintenance window 18.08.2026. Post-audit: 40 индексов, drift/data violations = 0.
  Полный baseline-план: `docs/DB_BASELINE_PLAN.md`.

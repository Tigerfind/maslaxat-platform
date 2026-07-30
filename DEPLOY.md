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
| `SMTP_HOST/PORT/USER/PASSWORD/FROM` | Любой SMTP: Gmail App Password, SendGrid, Mailgun, Yandex 360 | Письма (сброс пароля, верификация) уходят только в тестовый Ethereal (dev), реальные юзеры их не получают |
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

Заполнить (минимум для запуска):
- `NODE_ENV=production`
- `JWT_SECRET` — сгенерированный (`openssl rand -base64 48`)
- `DB_*` — доступ к PostgreSQL
- `REDIS_URL` — адрес Redis
- `CORS_ORIGINS` и `FRONTEND_URL` — ваш домен
- Ключи из таблицы выше по мере готовности

Фронтенд (`frontend/.env` или переменные сборки):
- `REACT_APP_API_URL=https://ВАШ_ДОМЕН/api`

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

---

## 4. База данных и миграции

Схема:
- **dev** — `sync({ alter: true })` (подгоняет схему под модели на лету, удобно).
- **prod** — `sync()` без alter (создаёт недостающие таблицы, но НЕ меняет существующие —
  безопасно). Осознанные изменения схемы в проде — **только через миграции**.

Миграции на sequelize-cli уже настроены (`migrations/`, `.sequelizerc`, `src/config/db-cli.js`):

```bash
cd backend/api
npm run db:migrate          # применить все новые миграции
npm run db:migrate:status   # что применено / ожидает
npm run db:migrate:undo     # откатить последнюю
```

Порядок при первом продакшен-запуске:
1. Поднять PostgreSQL, создать базу и пользователя, заполнить `DB_*` в `.env`.
2. Первый старт приложения создаст таблицы (`sync()` в prod).
3. Применить миграции: `NODE_ENV=production npm run db:migrate`.
4. (Опц.) сиды справочников: `npm run db:seed`.

> Новые изменения схемы вносим миграцией (`npx sequelize-cli migration:generate --name ...`),
> а не правкой моделей «на живую» в проде.

---

## 5. Деплой

### Вариант A — Railway (проще всего, конфиги уже в репозитории)

Готово в репозитории: `backend/api/railway.json` (NIXPACKS, `npm start`, healthcheck
`/api/health`) и `frontend/railway.json` (`CI=false npm run build` → `serve -s build -l $PORT`).
БД читает `DATABASE_URL` (плагин Railway), Redis — `REDIS_URL`. `engines.node >=18` в обоих
`package.json`. На первом старте прод создаёт схему через `sync()` — отдельная миграция не нужна.

Пошагово (аккаунт на railway.app + этот GitHub-репозиторий подключён):

1. **New Project → Deploy from GitHub repo** → выбрать `maslaxat-platform`.
2. **Плагины:** в проекте → *New* → **Database → PostgreSQL**; ещё раз → **Database → Redis**.
   Railway сам заводит переменные `DATABASE_URL` и `REDIS_URL`.
3. **Сервис Backend:** созданный из репозитория сервис → *Settings*:
   - **Root Directory:** `backend/api`
   - Railway подхватит `railway.json` (start `npm start`, healthcheck `/api/health`).
   - **Variables** (вкладка Variables у backend-сервиса):
     - `DATABASE_URL` → *Reference* на переменную из Postgres-плагина
     - `REDIS_URL` → *Reference* на Redis-плагин
     - `DB_SSL=1` (если Postgres-плагин требует TLS — обычно для внешнего подключения; для
       приватной сети Railway можно не ставить)
     - `NODE_ENV=production`
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

> Порядок первого запуска: сначала поднимется Postgres/Redis, затем backend (создаст схему через
> `sync()` и пройдёт healthcheck `/api/health`), затем frontend. Если backend не проходит
> healthcheck — почти всегда не проброшен `DATABASE_URL`/`REDIS_URL` или отсутствует `JWT_SECRET`.

### Вариант B — Docker Compose (есть `docker-compose.yml` + Dockerfiles)
```bash
# в корне репозитория
docker compose up -d --build
```
Проверить, что переменные окружения проброшены в контейнеры (не хардкодить в образ).

---

## 6. Пост-деплой проверка

- [ ] `GET /api/health` → 200
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

---

## 7. Что ещё в BACKLOG (не блокирует запуск)

- Реальный вывод денег юристом (сейчас тест-флоу; нужен Payme Transfer/выплаты).
- Мониторинг ошибок (Sentry), метрики.
- (Опц.) Сгенерировать baseline-миграцию для полностью чистого прод-деплоя без `sync()`.

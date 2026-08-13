# eMaslaXat

Онлайн-платформа юридической помощи для Узбекистана. Клиент может получить AI-консультацию, проверить документ, подобрать юриста и провести платную консультацию в чате или по видео.

## Возможности

- AI-чат и анализ PDF, DOCX и изображений через Claude
- проверяемые AI-источники из разрешённого корпуса LexUZ (`docs/LEGAL_KNOWLEDGE.md`)
- каталог, сравнение и избранное юристов
- бронирование, Payme и эскроу
- текстовый чат, Socket.IO-уведомления и WebRTC-видеозвонки
- кабинеты клиента, юриста и администратора
- RU, UZ и EN, PWA, web-push и TOTP 2FA
- подписки, промокоды, отзывы и аналитика

## Архитектура

Проект является модульным монолитом, а не набором микросервисов.

- `frontend/`: React 18, Redux Toolkit, MUI 5
- `backend/api/`: Express 4, Sequelize 6, Socket.IO
- PostgreSQL 16: основные данные
- Redis 7: AI-лимиты и опциональный Socket.IO adapter
- локальное файловое хранилище: документы и аватары

## Локальный запуск

Требуются Node.js 18+, PostgreSQL и Redis.

```bash
# Backend
cd backend/api
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev

# Frontend, в отдельном терминале
cd frontend
npm install
npm start
```

- Frontend: `http://localhost:3000`
- API: `http://localhost:3001/api`
- Healthcheck: `http://localhost:3001/api/health`

## Проверка

```bash
cd backend/api && npm test
cd frontend && npm run build:prod
```

Backend-тесты используют отдельную PostgreSQL БД `emaslaxat_test`.

## Production

Инструкция и список обязательных ключей находятся в [`DEPLOY.md`](DEPLOY.md). Перед запуском с реальными платежами обязательны:

- `ANTHROPIC_API_KEY`
- `PAYME_KEY` и `PAYME_MERCHANT_ID`
- SMTP и SMS-провайдер
- собственный TURN для WebRTC
- постоянный volume или объектное хранилище для uploads
- `npm run db:migrate` до запуска новой версии

Не включайте `RUN_SEED=1` на рабочей базе с реальными пользователями.

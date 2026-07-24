# eMaslaXat — CLAUDE.md (Главный файл для автономной разработки)

## КОНТЕКСТ ПРОДУКТА
Юридическая платформа для Узбекистана. Клиент описывает ситуацию →
AI отвечает по законам РУз бесплатно → при необходимости бронирует
видеозвонок с реальным юристом за деньги. Цель: заменить поход в офис.

## СТЕК
- Frontend: React 18 + Redux Toolkit + MUI 5 (порт 3000)
- Backend: Express 4.18 + Node.js 18 (порт 3001)
- ORM: Sequelize 6.35 + PostgreSQL 16
- Кэш: Redis 7
- Реалтайм: Socket.io 4.8
- Видео: simple-peer (WebRTC P2P)
- AI: @anthropic-ai/sdk (Claude Sonnet) — РЕАЛЬНЫЙ КЛЮЧ В .env
- Auth: JWT 7d + bcrypt 12 rounds

## КОМАНДЫ
```bash
# Backend
cd backend/api && npm run dev      # порт 3001
# Frontend
cd frontend && npm start           # порт 3000
# БД (нет миграций, sync alter)
cd backend/api && node src/seeds/index.js  # сидирование
```

## ТЕСТОВЫЕ АККАУНТЫ
- client@maslaxat.uz / client123
- admin@maslaxat.uz / admin123
- lawyer1@maslaxat.uz / lawyer123 (из seed)

## ЧТО РЕАЛЬНО РАБОТАЕТ (не трогать без причины)
- Регистрация/логин JWT
- Поиск юристов с фильтрами
- Бронирование консультаций
- Видеозвонки WebRTC P2P
- AI-чат Claude Sonnet (реальный API)
- Загрузка/удаление документов
- Расписание юриста
- Отзывы
- Мультиязычность RU/UZ/EN
- Админ панель (юристы, пользователи, специализации)

## ЧТО СЛОМАНО / ЗАГЛУШКИ (чинить по приоритету)

### КРИТИЧНО:
1. `POST /api/documents/:id/ai-check` → возвращает random 70-100 (ЗАГЛУШКА)
   Нужно: реальный анализ через Claude API, читать файл, вернуть структуру
2. Уведомления — модель есть, badge есть, но уведомления не генерируются
   Нужно: при каждом событии (бронь, подтверждение, отзыв) создавать Notification
3. Настройки профиля — UI есть, поля не сохраняются
   Нужно: PUT /api/users/profile endpoint сохраняющий все поля
4. Чат-консультации — нет текстового чата юрист↔клиент
   Нужно: модель Message, Socket.io чат, страница /consultations/chat/:id
5. График активности юриста — данные нули
   Нужно: считать реальные консультации за 7 дней из БД

### ВАЖНО:
6. Оплата — нет совсем. Консультации бронируются бесплатно
   Нужно: модель Payment, интеграция Payme (приоритет для РУз)
7. Сброс пароля — нет endpoint
8. Верификация email — поле isVerified есть, логики нет
9. Активность/responseRate юриста — всегда dash

## ПЛАН РАЗРАБОТКИ — ВЫПОЛНЯТЬ ПО ПОРЯДКУ

### БЛОК A — Заглушки → Реальные функции (делать сейчас)

**A1. AI анализ документов (файл: backend/api/src/routes/documents.js)**
Текущее: возвращает `{ score: Math.random() * 30 + 70 }`
Нужное:
```javascript
// Читать файл из ./uploads по document.path
// Если PDF — конвертировать в текст (pdf-parse)
// Если изображение — base64
// Отправить в Claude API с промптом:
const systemPrompt = `Ты юридический эксперт по законодательству Узбекистана.
Проанализируй документ и верни JSON:
{
  "documentType": "тип документа",
  "summary": "краткое содержание",
  "risks": ["риск1", "риск2"],
  "recommendations": ["действие1", "действие2"],
  "relevantLaws": ["ГК РУз ст.XXX", ...],
  "score": 0-100 (качество документа),
  "language": "ru/uz"
}
Отвечай на том же языке что документ.`
// Сохранить в document.aiAnalysis, вернуть клиенту
```

**A2. Система уведомлений (файл: backend/api/src/services/notificationService.js)**
Создать сервис и вызывать при каждом событии:
```javascript
// Создать файл: backend/api/src/services/notificationService.js
const createNotification = async (userId, type, title, message, metadata = {}) => {
  return await Notification.create({ userId, type, title, message, metadata });
};

// Вызывать из routes:
// При бронировании → уведомить юриста
// При подтверждении брони → уведомить клиента
// При новом отзыве → уведомить юриста
// При начале видеозвонка → уведомить обоих
// При завершении → уведомить обоих

// API endpoint для отметки прочитанным:
// PATCH /api/notifications/:id/read
// PATCH /api/notifications/read-all
// GET /api/notifications (с пагинацией)
```

**A3. График активности юриста**
```javascript
// В GET /api/dashboard/lawyer/stats добавить:
const weeklyActivity = await Consultation.findAll({
  where: {
    lawyerId: userId,
    createdAt: { [Op.gte]: moment().subtract(7, 'days').toDate() }
  },
  attributes: [
    [fn('DATE', col('createdAt')), 'date'],
    [fn('COUNT', col('id')), 'count']
  ],
  group: [fn('DATE', col('createdAt'))],
  raw: true
});
// Вернуть массив [{day: 'Пн', count: 3}, ...]
```

**A4. Текстовый чат юрист↔клиент**
Создать:
- Модель Message: { consultationId, senderId, text, isRead, createdAt }
- Socket.io события: join-chat, send-message, message-received, typing
- Страница: /consultations/chat/:id
- Компонент ChatWindow с историей и полем ввода
- Кнопка "Открыть чат" в карточке консультации

**A5. Настройки профиля**
```javascript
// Backend: PUT /api/users/profile
// Поля: name, phone, avatar (multer), password (с проверкой старого)
// Frontend: ProfilePageGlass и SettingsPageGlass вызывают этот endpoint
```

---

### БЛОК B — Оплата через Payme

**B1. Модели**
```javascript
// Добавить в models/index.js:
Payment: {
  consultationId, userId, amount, currency: 'UZS',
  provider: enum('payme', 'click', 'uzcard'),
  status: enum('pending', 'paid', 'failed', 'refunded'),
  transactionId, providerResponse: JSON
}
```

**B2. Флоу оплаты**
1. Клиент бронирует → создаётся Consultation со статусом payment_pending
2. Редирект на Payme checkout с суммой
3. Payme webhook → POST /api/payments/webhook → меняет статус на paid
4. Consultation статус → pending (ждёт подтверждения юриста)
5. Деньги хранятся на балансе платформы
6. После завершения консультации → баланс юриста +сумма

**B3. Эскроу логика**
```javascript
// LawyerProfile добавить: balance: decimal, pendingBalance: decimal
// При завершении консультации:
// pendingBalance → balance (через 24 часа или сразу)
// Endpoint: POST /api/lawyer/withdraw (вывод баланса)
```

---

### БЛОК C — Удержание пользователей (anti-churn)

**C1. Скрыть контакты юриста**
```javascript
// В GET /api/lawyers и GET /api/lawyers/:id
// НЕ возвращать phone, email юриста клиентам
// В чате: если юрист пишет номер телефона → заменить на ***
// Socket.io middleware для фильтрации:
socket.use((packet, next) => {
  if (packet[0] === 'send-message') {
    packet[1].text = packet[1].text.replace(
      /(\+?998\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2})/g, '***'
    );
  }
  next();
});
```

**C2. Юридическое досье клиента — страница /profile/portfolio**
Показывать всё что накоплено на платформе:
- Все документы с AI анализом
- История всех консультаций с кратким резюме
- Сохранённые AI-чаты
- Избранные юристы
Цель: показать ценность которую нельзя "перенести" при уходе

**C3. Подписки**
```javascript
// Модель Subscription: { userId, plan: enum('free','basic','pro'), expiresAt }
// FREE: 3 AI-запроса в день (проверять счётчик в /api/ai/chat/message)
// BASIC (99,000 сум): безлимит AI + 1 бесплатная консультация/месяц
// PRO (299,000 сум): безлимит AI + 3 консультации + приоритет в поиске
// Middleware checkSubscription() перед AI endpoints
```

**C4. Избранные юристы**
```javascript
// Модель FavoriteLawyer: { clientId, lawyerId }
// POST /api/favorites/:lawyerId (добавить)
// DELETE /api/favorites/:lawyerId (убрать)
// GET /api/favorites (список)
// В карточке юриста кнопка ♡ / ♥
// После завершения консультации: попап "Добавить в избранное?"
```

---

### БЛОК D — UX улучшения дашбордов

**D1. Дашборд клиента — AI-чат в центр**
Текущий путь к AI: /ai-chat (отдельная страница)
Нужное: на /dashboard встроить мини-чат прямо в страницу
```jsx
// Компонент QuickAIChat на дашборде:
// - Поле ввода с placeholder "Опишите вашу ситуацию..."
// - Последние 3 сообщения видны
// - Кнопка "Открыть полный чат" → /ai-chat
// - 5 кнопок быстрых вопросов: Трудовые споры | Аренда | Семья | Бизнес | Штрафы
```

**D2. Онбординг для новых юристов**
При первом входе (LawyerProfile.completedCases === 0 AND reviewsCount === 0):
```jsx
// Показать OnboardingWizard компонент:
// Шаг 1: Фото и описание (обязательно)
// Шаг 2: Специализации (минимум 1)
// Шаг 3: Расписание (минимум 3 слота в неделю)
// Шаг 4: Прайс-лист
// Пока не заполнено — профиль не виден в каталоге (isAvailable: false)
```

**D3. Пустые состояния**
Везде где список пустой добавить:
```jsx
// Компонент EmptyState({ icon, title, subtitle, actionLabel, onAction })
// Примеры:
// Консультации: "Ещё нет консультаций" + "Найти юриста →"
// Документы: "Загрузите документ для анализа AI" + "Загрузить →"
// Отзывы: "Пока нет отзывов" (без кнопки)
// Уведомления: "Всё прочитано ✓"
```

---

### БЛОК E — Мобильная адаптация

**E1. Bottom Navigation**
```jsx
// Компонент MobileBottomNav (показывать только на xs/sm breakpoint):
// [Главная] [Юристы] [Консультации] [Документы] [Профиль]
// Фиксированный внизу, z-index 1000
// Добавить padding-bottom: 64px к Layout на мобиле
```

**E2. Карточки метрик**
```jsx
// На xs: grid 2 колонки (не 4)
// <Grid item xs={6} sm={6} md={3}>
```

**E3. Каталог юристов на мобиле**
```jsx
// Фильтры: не сайдбар, а кнопка "Фильтры" → Drawer снизу
// Карточки: 1 в ряд на xs
```

**E4. Таблицы на мобиле**
```jsx
// Все MUI Table → на xs заменить на карточки
// Компонент ResponsiveTable({ columns, rows })
// На xs рендерит каждую строку как карточку
```

**E5. Минимальные размеры кнопок**
```jsx
// В axelionTheme.js:
MuiButton: { styleOverrides: { root: { minHeight: 44 } } }
MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } }
```

---

### БЛОК F — Системные улучшения

**F1. Сброс пароля**
```javascript
// POST /api/auth/forgot-password → генерировать token, отправить email (nodemailer)
// POST /api/auth/reset-password → проверить token, обновить пароль
// Хранить resetToken + resetTokenExpiry в User модели
```

**F2. Верификация email**
```javascript
// При регистрации: генерировать verificationToken
// Отправить email с ссылкой /verify-email?token=xxx
// GET /api/auth/verify-email/:token → isVerified: true
// В UI: показывать баннер "Подтвердите email" если !isVerified
```

**F3. Rate limiting для AI**
```javascript
// Уже есть общий rate limit (200 req/15min)
// Добавить специфичный для /api/ai:
// FREE: 3 запроса в день (Redis counter по userId)
// BASIC/PRO: безлимит
```

**F4. Логирование ошибок**
```javascript
// Добавить winston или pino в backend
// Все необработанные ошибки → файл logs/error.log
// В продакшне: не возвращать stack trace клиенту
```

---

## ПРАВИЛА АВТОНОМНОЙ РАБОТЫ

1. Читай этот файл перед каждой задачей
2. Проверяй стек — не устанавливай дублирующие библиотеки
3. После каждого изменения backend: перезапусти сервер, проверь что нет ошибок
4. После каждого изменения frontend: проверь консоль браузера
5. Ошибки исправляй сам, не спрашивай разрешения
6. Не ломай то что работает (список выше в "РЕАЛЬНО РАБОТАЕТ")
7. После блока: сам найди 3 проблемы и исправь
8. Обновляй раздел ПРОГРЕСС ниже

## ПРОГРЕСС

### Сделано:
- [x] A1 — AI анализ документов реальный (Claude API + pdf-parse)
- [x] A2 — Система уведомлений (notificationService.js + все события)
- [x] A3 — График активности юриста (реальные данные из БД)
- [x] A4 — Текстовый чат юрист↔клиент (Socket.io + REST + ChatPage.js)
- [x] A5 — Настройки профиля (PUT /api/users/profile + password)
- [x] B1 — Payment модель + balance/pendingBalance в LawyerProfile
- [x] B2 — Payme routes (webhook JSON-RPC 2.0, create, balance, withdraw)
- [x] B3 — Эскроу: pendingBalance → balance при завершении консультации
- [x] C1 — Скрыть контакты юристов (attributes filter + chat phone/email filter)
- [x] C2 — Юридическое досье (PortfolioPage.js: все документы, консультации, AI-чаты, избранные)
- [x] C3 — Подписки (Subscription модель + checkAIRateLimit по плану + /api/subscriptions routes)
- [x] C4 — Избранные юристы (FavoriteLawyer модель + API + FavoritesPage.js + иконка в каталоге)
- [x] D1 — AI-чат на дашборде (QuickAIChat компонент, быстрые вопросы, встроен в дашборд)
- [x] D2 — Онбординг юриста (OnboardingWizard.js 4 шага, показывается новым юристам)
- [x] D3 — Пустые состояния (EmptyState.js компонент + интегрирован)
- [x] E1 — Mobile Bottom Navigation (MobileBottomNav.js + Layout padding)
- [x] E2 — Карточки метрик 2 колонки на мобиле (xs={6} sm={6} lg={3})
- [x] E3 — Каталог юристов на мобиле (Drawer фильтры снизу, уже реализовано)
- [x] E4 — Таблицы на мобиле (ResponsiveTable.js компонент)
- [x] E5 — Минимальные размеры кнопок 44px (MuiButton minHeight:48, MuiIconButton 44x44)
- [x] F1 — Сброс пароля (nodemailer + forgot/reset endpoints + frontend pages)
- [x] F2 — Верификация email (verificationToken + sendVerificationEmail + VerifyEmailPage + баннер)
- [x] F3 — Rate limiting AI (3 req/day FREE via Redis counter, BASIC/PRO безлимит)
- [x] F4 — Логирование (winston: error.log + combined.log, HTTP middleware, signaling.js)
- [x] Попап оценки после консультации (RatingDialog.js)
- [x] Кнопка поддержки (SupportFAB.js с FAQ + контактная форма)
- [x] Удалены мок-данные из clientService.js

### ФАЗА 3 — Ключевые фичи (готово, проверено):
- [x] 3.1 «Записаться снова» на завершённых/архивных консультациях (BookingModal с тем же юристом)
- [x] 3.2 Красивый апселл при лимите 3/день → Pro (AILimitUpsell.js, ловим 429, upgrade в тест-режиме)
- [x] 3.3 AI: структурный ответ карточками (форматирование **жирного**/списков + карточка «Статьи
      закона» через extractLaws + карточка «Важно») + кнопка «Записаться к юристу по теме»
      (aiFormat.js; парсинг на фронте — работает и для истории, и в fallback-режиме AI)
- [x] 3.4 Realtime-уведомления через socket (socket/io.js реестр + персональная комната user:<id> +
      emit из notificationService; фронт NotificationCenter слушает 'notification:new', поллинг → 60с
      fallback). ПРОВЕРЕНО вживую: юрист получил пуш мгновенно после оплаты клиентом.
- [x] 3.5 Напоминание за 1 час до консультации (reminderService.js: джоб каждые 5 мин, колонка
      Consultation.reminderSent, уведомление обоим + email). ПРОВЕРЕНО: оба участника, email,
      идемпотентность (повторный прогон = 0).

### ФАЗА 4 — Кабинеты и данные (готово, проверено):
- [x] 4.1 Аналитика юриста: страница /lawyer/analytics + пункт меню. Бэкенд
      GET /lawyer/dashboard/analytics (доход по месяцам за 6 мес по факт. цене завершённых,
      воронка requests→accepted→completed с %, разбивка оценок по звёздам, баланс/pending).
      ПРОВЕРЕНО: Иванов — воронка 7→6→6, рейтинг 4.8, 5★×5/4★×1.
- [x] 4.2 Управление слотами расписания: редактор «Часы приёма» на /lawyer/schedule
      (7 дней, тумблер + время from/to). Бэкенд GET/PUT /lawyer/availability (schedule JSONB +
      валидация HH:mm). ПРОВЕРЕНО: сохранение/чтение, невалидное время → дефолт.
- [x] 4.3 Реальные отчёты админки: секция в AdminDashboardGlass (выручка по месяцам,
      топ юристов, консультации по статусам). Бэкенд GET /admin/dashboard/reports
      (totalRevenue по paid Payments, monthlyRevenue, consultationsByStatus, usersGrowth, topLawyers).
      ПРОВЕРЕНО: выручка 3 209 000, разбивка по статусам, топ-5 юристов.
- [x] 4.4 Фикс анализа .doc/.docx: установлен mammoth, extractRawText вместо чтения бинаря как
      utf-8 (.txt отдельно, .doc с graceful-фолбэком → просьба .docx/PDF). ПРОВЕРЕНО: чистый
      русский текст из реального .docx.

### ФАЗА 5 — Премиум-UX (готово, проверено):
- [x] 5.1 Авторизация: анимация входа (framer-motion), «запомнить меня» (rememberedEmail),
      инлайн-валидация email/пароль, индикатор силы пароля на регистрации (0-4), убраны мёртвые
      mockUser; демо-логины теперь только в dev (process.env.NODE_ENV) без плашки с паролем.
- [x] 5.2 VerifyEmailPage: dispatch updateProfile({isVerified:true}) после успеха + корректная
      навигация (залогинен → кабинет, иначе → вход).
- [x] 5.3 Скелетоны загрузки: components/UI/Skeleton.js (shimmer) на каталоге юристов и консультациях.
- [x] 5.4 401-хендлинг: api.js чистит token+role+user, не редиректит на auth-запросах и не зацикливает;
      ErrorBoundary.js оборачивает приложение (брендовый фолбэк вместо белого экрана).
- [x] 5.5 Удалено 8 мёртвых файлов: PageTransition, AnimatedBackground, DebugPanel, ResponsiveTable,
      UI/GlassCard (дубль; Glass/GlassCard оставлен — нужен лендингу), Lawyers/VideoIntroModal,
      Neumorphic/ (2 файла), src/modules/ (сломанный export). 0 повисших импортов.

### ФАЗА 6 — Деплой: подготовка без ключей (готово):
- [x] 6.1 PWA-иконки: сгенерированы PNG 64/180/192/512 из app-icon.svg; manifest.json больше не
      ссылается на несуществующий favicon.ico; index.html → apple-touch-icon.png + favicon PNG.
- [x] 6.2 Socket.io Redis-адаптер: socket/redisAdapter.js, подключается по флагу SOCKET_REDIS=1
      (по умолчанию выкл, одиночный инстанс без изменений). Установлен @socket.io/redis-adapter.
- [x] 6.3 Прод-харденинг: errorHandler уже скрывает stack при NODE_ENV=production; .env.example
      дополнен SOCKET_REDIS и TURN_*.
- [x] 6.4 DEPLOY.md — чеклист деплоя: где взять каждый ключ, что включается автоматически,
      шаги Railway/Docker, пост-деплой проверка.
- [ ] ОСТАЛОСЬ (требует ключей/сервисов от пользователя): реальные ANTHROPIC/PAYME/SMTP,
      свой TURN, сам деплой, переход sync→миграции. Всё описано в DEPLOY.md.

### Исправленные баги:
- Subscription.upsert → findOne + update/create (upsert не работал без уникального индекса)
- User.toJSON() теперь скрывает resetToken, resetTokenExpiry, verificationToken
- signaling.js: console.log/error → winston logger

### Текущие проблемы:
- sequelize.fn('DATE') может отличаться между PostgreSQL и SQLite — проверить в проде
- Нужна реальная SMTP конфигурация для email (сброс пароля использует Ethereal в dev)
- Payme ключи нужно получить на merchant.payme.uz и прописать в .env

### BACKLOG (техдолг, отдельными решениями):
- **Удалить мёртвые столбцы `Consultation.rating` и `Consultation.review`** (миграция). Оценка
  консультации живёт ТОЛЬКО в таблице `Review` (`consultationReview`). Эти столбцы всегда NULL,
  сейчас помечены DEPRECATED в models/index.js. Убрать после отдельного решения по миграции,
  чтобы никто случайно не начал писать в них (два источника правды).
- **Сделать `POST /lawyers/:id/review` идемпотентным** (один отзыв на консультацию): сейчас
  `Review.create` без проверки → повторная оценка создаёт дубликат Review (найдено: 1 дубль в
  dev-данных, консультация 2c660517 x2). Из-за этого `hasOne`-include может задвоить строку
  консультации — на фронте временно защищено дедупликацией по id. Правильный фикс — findOrCreate/
  update по (consultationId, clientId) + чистка существующих дублей. Отдельное решение.

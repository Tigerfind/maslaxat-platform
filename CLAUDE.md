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

### Исправленные баги:
- Subscription.upsert → findOne + update/create (upsert не работал без уникального индекса)
- User.toJSON() теперь скрывает resetToken, resetTokenExpiry, verificationToken
- signaling.js: console.log/error → winston logger

### Текущие проблемы:
- sequelize.fn('DATE') может отличаться между PostgreSQL и SQLite — проверить в проде
- Нужна реальная SMTP конфигурация для email (сброс пароля использует Ethereal в dev)
- Payme ключи нужно получить на merchant.payme.uz и прописать в .env

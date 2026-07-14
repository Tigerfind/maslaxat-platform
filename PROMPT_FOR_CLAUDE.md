# Промпты для Claude: сборка платформы eMaslaXat

Здесь два готовых промпта:
1. **ПРОМПТ №1** — построить полноценную веб-платформу eMaslaXat.
2. **ПРОМПТ №2** — построить мобильное приложение (после того как веб готов).

Копируй нужный блок целиком и отдавай Claude (Claude Code / Claude в дизайн-режиме).

---
---

# ПРОМПТ №1 — ВЕБ-ПЛАТФОРМА eMaslaXat

> Скопируй всё, что ниже, до пометки «КОНЕЦ ПРОМПТА №1».

---

## РОЛЬ

Ты — senior full-stack инженер и продуктовый дизайнер одновременно. Твоя задача — спроектировать и реализовать полноценную, production-ready веб-платформу юридического сервиса **eMaslaXat** для Узбекистана. Работай автономно: сам принимай инженерные решения, сам исправляй ошибки, не ломай то, что уже работает. Пиши чистый, консистентный код, единый визуальный язык на всех экранах, полную адаптивность (mobile-first) и поддержку трёх языков (RU / UZ-Cyrillic / EN).

## ПРОДУКТ (что мы строим и зачем)

eMaslaXat — это «юрист в кармане» для граждан Узбекистана. Пользователь описывает проблему → **AI-помощник (Claude)** бесплатно отвечает по законам РУз → если нужен живой юрист, клиент **бронирует и оплачивает видео/чат-консультацию** с проверенным юристом. Цель — заменить поход в юридический офис: без очередей, без переплат, помощь «за 5 минут».

Три ключевые ценности на лендинге: **Видеоконсультации**, **AI-помощник**, **Документы онлайн** (загрузка + AI-анализ). Слоган: «Юридическая помощь за 5 минут».

Монетизация: платные консультации (эскроу через Payme) + подписки (free / basic / pro).

## РОЛИ И ЧТО У КАЖДОЙ ЕСТЬ

Роль хранится в `User.role ∈ {client, lawyer, admin}`. Регистрироваться могут только `client` и `lawyer`; `admin` создаётся сидом.

**КЛИЕНТ** — обычный пользователь. Имеет: профиль, подписку, консультации (как клиент), AI-чаты, документы с AI-анализом, отзывы (которые он пишет), избранных юристов, платежи, уведомления, чат внутри консультаций.

**ЮРИСТ** — User + расширенный профиль LawyerProfile. Имеет: профессиональный профиль (специализация, опыт, цена, языки, образование, сертификаты, расписание), баланс + эскроу-баланс, входящие заявки и консультации (как юрист), полученные отзывы (+ответы на них), уведомления, онлайн-статус. Юрист проходит онбординг и модерацию админом перед показом в каталоге.

**АДМИН** — управляет пользователями (блок/разблок), модерирует юристов (одобрить/отклонить), ведёт CRUD специализаций, видит все консультации и статистику платформы.

## ТЕХНОЛОГИЧЕСКИЙ СТЕК (соблюдай точно)

- **Frontend:** React 18 + React Router v6 + Redux Toolkit + React Query + MUI v5 (`@mui/material` + `@mui/icons-material`) + Framer Motion. Реалтайм: `socket.io-client` + `simple-peer` (WebRTC P2P). Уведомления: `react-toastify`. Порт 3000.
- **Backend:** Express 4 + Node.js 18. Порт 3001. JWT (7d) + bcrypt (12 rounds). Helmet, CORS, rate-limit (200 req/15мин).
- **ORM/БД:** Sequelize 6 + PostgreSQL 16 (в dev допустим `sync({alter:true})`, без миграций). Все PK — UUIDv4.
- **Кэш:** Redis 7 (счётчик AI-лимитов).
- **Реалтайм:** Socket.io 4 (сигналинг WebRTC + текстовый чат).
- **AI:** `@anthropic-ai/sdk`, модель `claude-sonnet-4-5` (или новее). Ключ в `.env`.
- **Оплата:** Payme (JSON-RPC 2.0 webhook). Валюта UZS (в тийинах ×100).
- **Файлы:** Multer, диск `./uploads`, статика `/uploads`. `pdf-parse` для PDF.
- **Email:** nodemailer (в dev — Ethereal).
- **i18n:** собственный контекст, 3 языка (RU дефолт, UZ-кириллица, EN), персист в localStorage.

## ДИЗАЙН-СИСТЕМА (обязательна к точному соблюдению)

Эстетика: **flat minimalist «тихая роскошь»** — кремовый фон, золотые акценты, тонкая типографика Inter с широким трекингом и UPPERCASE у заголовков/кнопок. НЕ glassmorphism, НЕ неоморфизм, НЕ яркие градиенты. Всё плоское, воздушное, дорогое. (Ориентир — существующий лендинг: бежевый фон, золото, крупная жирная типографика заголовков «ЮРИДИЧЕСКАЯ ПОМОЩЬ ЗА 5 МИНУТ».)

Все токены — в одном файле `theme/theme.js` (MUI `createTheme`). Реализуй и светлую, и **тёмную** тему, и реально переключай её из настроек (сейчас тёмная тема не подключена — исправь).

**Палитра (точные hex):**
- Золото/бронза: `gold #B8956E` (primary), `goldLight #C9A980`, `goldDark #9A7B5A`, `goldMuted #D4C5B5`, `bronze #8B7355` (secondary), `bronzeLight #A68B6A`, `bronzeDark #6B5A45`.
- Фоны (крем): `bgLight #FFFFFF` (paper), `bgCream #F5F1EB` (default), `bgWarm #FAF8F5`, `bgBeige #E8DFD5`, `bgSand #D4C5B5`.
- Тёмная: `bgDark #1A1A1A`, `bgDarkCard #2D2D2D`, `bgDarkElevated #3A3A3A`.
- Текст: `textDark #1A1A1A`, `textPrimary #2D2D2D`, `textSecondary #6B6B6B`, `textMuted #9A9A9A`, `textLight #FFFFFF`, `textGold #B8956E`.
- Бордюры: `borderLight #E8E4DE`, `borderMedium #D4C5B5`, `borderDark #3A3A3A`.
- Статусы (приглушённые): success `#7A9A6B` / bg `#E8F0E4`; warning `#C4A35A` / bg `#F5EFE0`; error `#B07070` / bg `#F5E8E8`; info `#6A8A9A` / bg `#E4EEF2`.

**Типографика:** единственный шрифт **Inter** (300/400/500/600/700), подключить через Google Fonts. Заголовки — вес 300, широкий `letter-spacing` (h1 0.2em, h2 0.15em), **UPPERCASE**. Body — вес 400, lh 1.6. `overline`/`button` — 500, 0.1em, UPPERCASE.
- h1 2.5rem/300/0.2em/UPPERCASE, h2 2rem/300/0.15em/UPPERCASE, h3 1.5rem/300/0.1em, h4 1.25rem/400, h5 1.125rem/400, h6 1rem/500, body1 1rem, body2 0.875rem, button 0.875rem/500/0.1em/UPPERCASE.

**Форма/тени:** единый `borderRadius: 8` для карточек/диалогов; контролы (кнопки/инпуты/чипы) можно 8px — **не делай двух конфликтующих радиусов** (в старой версии были 2px и 8px — унифицируй до 8). Тени очень мягкие, низкоконтрастные (`rgba(26,26,26,0.04–0.12)`), у кнопок тени нет (`boxShadow: none`), лёгкий hover-lift `translateY(-2px)`.

**Компоненты MUI (overrides):** Button — radius 8, padding 12×32, **minHeight 48**, weight 500, 0.1em, UPPERCASE, без тени, transition `.3s cubic-bezier(.4,0,.2,1)`; contained = золото→goldDark hover; containedSecondary = тёмный `#1A1A1A`; outlined = 1px золото. IconButton — **min 44×44** (touch target). TextField — 1px `#E8E4DE`, hover/focus золото, padding 14×16. Chip — bg бежевый `#E8DFD5`. AppBar — белый, без тени, 1px нижний бордюр. Золото на Switch/Checkbox/Radio/Slider/Badge/Progress в active-состоянии.

**Брендинг:** логотип — золотая литера **«M»** (или иконка весов ⚖️) + вордмарк **eMaslaXat** + тонкая подпись **LEGAL PLATFORM**. На лендинге — бежевый фон, крупные UPPERCASE-заголовки, золотые CTA-кнопки, тёмная вторичная кнопка. Переключатель языка — три пилюли (флаг + RU/UZ/EN), активная залита золотом.

**Глобальный CSS:** фон body `#F5F1EB`, кастомный золотистый скроллбар, золотое выделение текста, золотой focus-outline, инпуты `font-size:16px` на мобиле (чтобы iOS не зумил), уважай `prefers-reduced-motion`.

## МОДЕЛЬ ДАННЫХ (Sequelize, все PK — UUIDv4, timestamps авто)

- **User**: email(unique), password(bcrypt hook, cost 12), name, phone, role enum(client/lawyer/admin, default client), avatar, isVerified(bool), isActive(bool), resetToken, resetTokenExpiry, verificationToken. `toJSON()` вырезает password и все токены. Метод `comparePassword`.
- **LawyerProfile** (1:1 к User): userId, specialization*, description(text), experience(int, лет), price(int, UZS), rating(float), reviewsCount(int), completedCases(int), location, languages(array, дефолт ['uz','ru']), education(jsonb), certificates(jsonb), schedule(jsonb), isAvailable(bool — онлайн-статус И гейт завершённости онбординга), balance(decimal), pendingBalance(decimal, эскроу).
- **Consultation** (центральная сущность): clientId, lawyerId, type enum(video/chat/phone, default video), status enum(**payment_pending/pending/accepted/rejected/in_progress/completed/cancelled**), question*(text), description(text), preferredDate(dateonly), preferredTime, price(int, снимок цены при брони), notes(text — причины отмены/заметки).
- **AIConversation**: userId, title(дефолт «Новый разговор»), category. → **AIMessage**: conversationId, text, isUser(bool), category.
- **Document**: userId, name, type, size, path, status enum(pending/verified/issues/rejected), aiAnalysis(jsonb: documentType, summary, risks[], recommendations[], relevantLaws[], score 0-100, language, issues[], risk).
- **Review**: clientId(автор), lawyerId(цель), consultationId, rating(1-5)*, text, replyText, repliedAt, helpfulCount.
- **Notification**: userId, type, title*, message, isRead(bool), metadata(jsonb). Типы: booking_new, booking_accepted, booking_rejected, consultation_started, consultation_completed, consultation_cancelled, new_review, document_analyzed. (Унифицируй имена типов — не плоди `new_booking` vs `booking_new`.)
- **Specialization**: name(unique), nameUz, nameEn, icon(дефолт 'Gavel'), isActive(bool), lawyerCount(int — реально поддерживай счётчик).
- **Message** (чат клиент↔юрист): consultationId, senderId, text, isRead(bool). (Отдельно от AIMessage.)
- **FavoriteLawyer**: clientId, lawyerId, unique(clientId, lawyerId).
- **Subscription** (1:1 к User): userId, plan enum(free/basic/pro), expiresAt(nullable), price(int).
- **Payment**: consultationId, userId, amount(decimal), currency(default UZS), provider enum(payme/click/uzcard), status enum(pending/paid/failed/refunded), transactionId, providerResponse(jsonb).

Ассоциации: User 1–1 LawyerProfile; User 1–* Consultation (client/lawyer); User 1–* AIConversation 1–* AIMessage; User 1–* Document; Consultation 1–1 Review; Consultation 1–* Message; Consultation 1–1 Payment; User 1–1 Subscription; User 1–* FavoriteLawyer (обе стороны).

## API (Express, префикс /api; JWT в `Authorization: Bearer`)

Middleware: `authenticate` (проверяет JWT, грузит User, отклоняет если !isActive), `authorize(...roles)` (403 если роль не подходит). Проверки владения — на каждом роуте (юрист меняет только свои консультации; чат/видео — только участники).

- **auth**: POST /register, POST /login, GET /me, POST /forgot-password, POST /reset-password, GET /verify-email/:token, POST /resend-verification.
- **users**: PUT /profile (multipart avatar + name/phone), PUT /password (проверка старого).
- **lawyers** (публичный каталог — НЕ отдавать email/phone юриста клиентам): GET / (поиск/фильтр по specialization/search/minRating, сортировка rating/price/experience, пагинация), GET /:id (профиль + последние отзывы), POST /:id/book (client), POST /:id/review (client).
- **consultations**: GET / (скоуп по роли), GET /upcoming, GET /:id (участник), PATCH /:id/status (lawyer/admin — на `completed` запускает эскроу-расчёт), POST /:id/join, POST /:id/cancel.
- **lawyer-portal** (`authorize('lawyer')`): заявки (accept/reject), consultations (confirm/reject/start/end), schedule, reviews (+reply, +helpful), notifications, profile (GET/PUT multipart, авто isAvailable=true при заполнении), status (online/offline).
- **admin-portal** (`authorize('admin')`): activity/recent, users (list + status block/unblock), lawyers (approve/reject), specializations CRUD, consultations (мониторинг).
- **dashboard**: GET /client/stats, /lawyer/stats (в т.ч. weeklyActivity[7] реальными данными + responseRate), /admin/stats, /specializations (публич).
- **ai**: POST /chat/message (rate-limit по подписке: free 3/день через Redis, basic/pro безлимит; файлы до 10MB → Claude vision; системный промпт про право РУз; извлекать `[КАТЕГОРИЯ]`), GET /chat/conversations, GET /chat/history/:id.
- **documents**: GET /, POST /upload (multer ≤10MB), DELETE /:id, POST /:id/ai-check (pdf-parse/base64/utf8 → Claude → JSON-анализ → aiAnalysis + status по score, уведомление).
- **notifications**: GET / (+unreadCount), GET /unread-count, PATCH /:id/read, PATCH /read-all.
- **chat**: GET /:consultationId/messages (участник, помечает прочитанным), POST /:consultationId/messages (**фильтрует телефоны и email на `***`** — анти-обход платформы), GET /:consultationId/unread.
- **video**: GET /consultation/:id, POST .../start, POST .../end. Медиа — WebRTC P2P, сигналинг через Socket.io (`join-room`, `signal`, `user-joined/left`, `end-call`, комната `consultation:{id}`, макс 2, JWT в хендшейке).
- **payments** (Payme): POST /create (client, из статуса payment_pending → checkout URL), POST /webhook (JSON-RPC 2.0: CheckPerform/Create/Perform/Cancel/Check/GetStatement; на Perform → Payment paid, Consultation pending, lawyer.pendingBalance += amount, уведомить юриста), GET /my, GET /balance (lawyer), POST /withdraw (lawyer — сделай реальную запись о выводе, не просто декремент).
- **subscriptions**: GET /plans (free 0 / basic 99000 / pro 299000), GET /my (авто-создание free, аи-лимит и aiUsedToday), POST /upgrade (+1 месяц).
- **favorites**: POST/:lawyerId, DELETE /:lawyerId, GET /, GET /check/:lawyerId.

## КЛЮЧЕВЫЕ БИЗНЕС-ФЛОУ (реализуй строго и без дублей)

1. **Регистрация/логин.** Register → User (bcrypt hook); юрист дополнительно получает LawyerProfile с `isAvailable=false` (скрыт до онбординга). Отправить письмо верификации (не блокировать вход). Login → `{user, token, role}`, редирект по роли. Юристу для попадания в каталог нужен: (а) заполненный профиль (isAvailable=true) и (б) одобрение админа (isVerified=true).
2. **Бронирование — ЕДИНЫЙ путь (унифицируй!).** В старой версии два конфликтующих пути (payment_pending vs прямой pending). Сделай ОДИН: клиент бронирует → Consultation `payment_pending` → оплата Payme → webhook Perform → `pending` + эскроу + уведомление юристу → юрист accept/reject.
3. **Оплата/эскроу.** Деньги при оплате попадают в `pendingBalance` юриста. При завершении консультации (**единая точка** `PATCH /consultations/:id/status → completed`) сумма переходит `pendingBalance → balance`, `completedCases++`. Не делай второй путь завершения без эскроу.
4. **Видеозвонок.** Открытие страницы → проверка участника → Socket.io join-room → WebRTC offer/answer/ICE через `signal`. Статусы start/end. STUN Google + TURN (openrelay). Учти React StrictMode (гард от двойного старта peer).
5. **AI-чат.** Rate-limit по подписке → Claude Sonnet с промптом про законы РУз (поддержка вложений image/pdf/txt) → сохранить оба сообщения → извлечь категорию → в правой панели показать подходящих юристов по категории.
6. **AI-анализ документа.** Загрузка → извлечь текст → Claude → структурный JSON (тип, резюме, риски, рекомендации, законы, score) → status по score (≥80 verified, ≥50 issues, иначе rejected) → уведомление.
7. **Вывод средств юриста.** Баланс + эскроу; заявка на вывод создаёт запись, декрементит balance (реальную выплату можно оставить заглушкой, но с персистентной записью).

---

## ПОЛНАЯ КАРТА СТРАНИЦ (для каждой: назначение, что внутри, действия, данные)

Правило: **одна страница = один файл**, без дублей `Glass/не-Glass`, без мёртвого кода. Все списки с пустым состоянием — через единый компонент `EmptyState`. Все данные — из API, **никаких mock-заглушек в проде**.

### ГОСТЬ / ПУБЛИЧНЫЕ

**Лендинг `/`** (новый — сейчас его нет, только редирект). Назначение: продать сервис незалогиненному посетителю. Внутри: хедер (лого eMaslaXat, навигация «Как это работает / Функции / Тарифы / Юристам / FAQ», телефон, переключатель языка, CTA «Получить консультацию»); hero-блок с крупным UPPERCASE-заголовком «Юридическая помощь за 5 минут», подзаголовком, фиче-бейджами (Видеоконсультации / AI-помощник / Документы онлайн / Безопасно), двумя CTA («Получить консультацию» → /register?role=client, «Стать юристом платформы» → /register?role=lawyer) и иллюстрацией (мокап видеозвонка + карточка «Договор.pdf» + AI-помощник); секции «Как это работает» (3-4 шага), «Функции», «Тарифы» (3 карточки free/basic/pro), «Для юристов», «FAQ» (аккордеоны), футер. Полностью адаптивный.

**`/login`** — единый вход для всех ролей. Карточка по центру, лого. Табы «Клиент / Юрист / Админ» (влияют на демо-плейсхолдер). Форма email + пароль (toggle видимости), «Войти» (золотой градиент). «Забыли пароль?» → /forgot-password. Блок демо-входа (client@maslaxat.uz/client123, lawyer1@maslaxat.uz/lawyer123, admin@maslaxat.uz/admin123). Ссылка на регистрацию. LanguageSwitcher. API: POST /auth/login → редирект по роли.

**`/register`** — регистрация client/lawyer. ToggleButtonGroup роли; поля имя/email/телефон/пароль/подтверждение; для юриста доп. «Специализация» + инфоблок «после регистрации заполните профиль». API: POST /auth/register.

**`/forgot-password`** — поле email → «Отправить ссылку» → экран «Письмо отправлено». API: POST /auth/forgot-password.

**`/reset-password?token=`** — новый пароль + подтверждение; без токена — «Недействительная ссылка»; успех → «Войти». API: POST /auth/reset-password.

**`/verify-email?token=`** — три состояния (loading/success/error) + кнопка в кабинет. API: GET /auth/verify-email/:token.

### КЛИЕНТ (внутри общего `Layout`: баннер «подтвердите email», SupportFAB, MobileBottomNav, анимация переходов)

**`/dashboard`** — главная клиента. Хедер (лого, аватар/имя, чип «КЛИЕНТ», язык, колокол уведомлений, шестерёнка→settings, выход; на мобиле — гамбургер→Drawer). 4 стат-карточки (активные консультации / документы / завершённые / AI-чаты) — на xs в 2 колонки. Онбординг-чеклист (3 шага) для новичков. Виджет **QuickAIChat** (встроенный мини-AI-чат: чипы быстрых вопросов Трудовые/Аренда/Семья/Бизнес/Штрафы, последние 3 сообщения, «Открыть полный чат»). Быстрые действия (Спросить AI / Найти юриста / Мои консультации). «Предстоящие консультации» (таблица на desktop, карточки на mobile, кнопка «Присоединиться»). API: dashboard/client/stats, consultations/upcoming.

**`/ai-chat`** — AI-юрконсультант (ключевая фича). 3 колонки на desktop (слева история разговоров, центр — чат, справа «Подходящие юристы»), на mobile — Drawer'ы. Слева: «Новый разговор» + список. Центр: приветствие, чипы категорий права (Гражданское/Семейное/Трудовое/Уголовное/Корпоративное/Земельное), пузыри сообщений, индикатор «печатает», копирование ответа. Ввод: прикрепление файлов (≤10MB image/pdf/doc), textarea, отправка. Справа: карточки юристов по категории с бейджем «Рекомендован» и «Записаться». API: ai/chat/*, lawyers?specialization=.

**`/consultations`** — мои консультации. Хедер + «Book New»→/lawyers. Табы Все/Предстоящие/Завершённые/Отменённые (со счётчиками). Карточка: аватар/имя юриста, чип специализации, рейтинг, вопрос, детали (дата/время/тип/стоимость), статус-чип. Действия: «Войти в видео»/«Открыть чат», «Отменить» (диалог с причиной), для завершённых без оценки — «Оценить» (RatingDialog → отзыв). API: consultations, cancel, join.

**`/lawyers`** — каталог юристов. Поиск (имя/специализация). Фильтры (сайдбар на desktop, bottom-Drawer на mobile): специализация, мин. рейтинг, диапазон цены (Slider), опыт, сортировка. Сетка карточек: аватар, имя, рейтинг+отзывы, чипы специализаций, опыт, «от N сум», регион, % успешных дел, иконка избранного (toggle), «Book Consultation» → BookingModal. Пагинация. Клик по карточке → /lawyers/:id. API: lawyers (search+filters+page), favorites.

**`/lawyers/:id`** — профиль юриста (**реальные данные из API, не mock!**). Левая колонка: аватар, verified-бейдж, рейтинг, метрики (время ответа/успех/опыт/регион), цена, кнопки «Записаться» (BookingModal), «Начать чат», «Видеозвонок». **Контакты (телефон/email) юриста НЕ показывать.** Правая: табы «О юристе» (bio/специализации/образование/языки/сертификаты), «Отзывы» (сводка + список), «Портфолио» (метрики). API: GET /lawyers/:id.

**`/documents`** — документы + AI-проверка. Хедер + «Загрузить» (диалог: PDF/DOC/DOCX ≤10MB, прогресс). Сетка карточек: иконка, статус (verified/warning/error), имя, тип, AI-оценка (LinearProgress), размер/дата. Действия: скачать, удалить (диалог), «AI проверка» (диалог с loader → summary/risks/recommendations/relevantLaws/score/risk). API: documents/*.

**`/favorites`** — избранные юристы. Счётчик, сетка карточек (аватар/имя/рейтинг/спец./опыт/цена/регион), убрать из избранного, «Смотреть профиль». Пусто → EmptyState «Найти юриста». API: favorites.

**`/portfolio`** — «Юридическое досье» (агрегатор ценности, anti-churn). 4 стат-карточки (Документы/Консультации/AI-чаты/Избранные) + табы с сетками карточек по каждой категории, клик уводит на нужную страницу. Пусто → EmptyState. API: Promise.all(documents, consultations, aiChat conversations, favorites, stats).

**`/profile`** — мой профиль. Шапка (аватар, имя/email, чипы «Активный»/«Клиент»). Табы: «Личная информация» (имя/email/телефон/адрес, режим редактирования, аватар-аплоад, **реальная статистика аккаунта из API**), «Безопасность» (смена пароля), «История активности» (**реальный лог из API, не mock**). API: PUT /users/profile, PUT /users/password.

**`/settings`** — настройки. Секции: Уведомления (email/push toggles — **сохранять на бэкенд**), Приватность, Язык (RU/UZ/EN), Тема (**тёмная тема — реально применять глобально**), Отображение (размер шрифта, компактный режим). «Сохранить»/«Сбросить», «Выйти» (диалог). Сделай `/settings` и `/profile` доступными и юристу, и админу (сейчас role-guard их выкидывает — исправь).

**`/help`** — реальная страница помощи (сейчас заглушка): FAQ-аккордеоны, форма обращения (с отправкой на бэкенд), контакты. Или объедини с SupportFAB.

### КЛИЕНТ + ЮРИСТ (полноэкранные, без Layout)

**`/consultations/video/:id`** — WebRTC-видеозвонок. Тёмный UI. Верх: бренд, статус (Connecting/Waiting/Connected), таймер. Центр: удалённое видео (fullscreen) + локальное PiP (зеркальное) + оверлей с именем/ролью. Низ: микрофон, камера, шэринг экрана (getDisplayMedia + replaceTrack), fullscreen, завершить. Socket.io сигналинг + simple-peer. API: video/consultation/:id, start, end.

**`/consultations/chat/:id`** — текстовый чат консультации. Хедер (имя собеседника + «печатает…»). Лента пузырей (свои/чужие + время), пусто → «Начните диалог». Ввод multiline (Enter=отправить). Socket.io (join-chat/send-message/message-received/typing) + REST-fallback. Анти-обход: фильтрация телефонов/email. API: chat/:id/messages.

### ЮРИСТ

**`/lawyer/dashboard`** — кабинет юриста. Если юрист новый (0 кейсов, 0 отзывов) — вместо дашборда полноэкранный **OnboardingWizard** (4 шага: Профиль/Специализации/Расписание/Прайс, валидация: описание ≥50 симв, ≥1 спец, ≥3 дня, цена ≥50k). Иначе дашборд: хедер (аватар, имя, чип «ЮРИСТ», toggle online/offline, рейтинг, язык, уведомления, «редактировать профиль», настройки, выход); 4 стат-карточки (заработок за месяц / активные клиенты / завершённые / общий доход); «Входящие заявки» (карточки вопрос/тип/дата/цена + Принять/Отклонить); «Предстоящие консультации» (таблица + «Начать» → video/chat, «Календарь» → /lawyer/schedule); «Последние отзывы» + «Смотреть все»; аналитика — **реальный** столбчатый график «Активность за неделю» + «Скорость ответа»/«Рейтинг». API: lawyer/dashboard/stats, pending, reviews/recent, requests, status.

**`/lawyer/schedule`** — календарь консультаций. Месячный календарь (RU дни/месяцы), навигация по месяцам, точки на днях с событиями. Правая панель: события выбранного дня (время/тип/клиент/тема), для pending — Принять/Отклонить. API: lawyer/schedule?year&month, confirm, reject.

**`/lawyer/profile/edit`** — редактирование профиля. Карточки: фото (аплоад), основная инфо (описание ≥50, опыт Slider 0-40, город, цена ≥50k), специализация (чипы, одна), расписание (дни недели + время start/end). «Сохранить». API: GET/PUT /lawyer/profile (multipart).

**`/lawyer/reviews`** — отзывы клиентов. **Переделать: сейчас mock + чужеродный бирюзовый неоморфный дизайн — привести к золотой теме и реальным данным.** Левая колонка: средний рейтинг + распределение по звёздам (клик = фильтр). Правая: табы (Все/Положительные/С комментариями) + карточки отзывов (лайк/ответить). API: lawyer/reviews, reply, helpful.

**`/lawyer/settings`, `/lawyer/profile`** — доступ к общим настройкам/профилю (исправить guard).

### АДМИН

**`/admin/dashboard`** — панель администратора. Хедер (щит-аватар, «Панель администратора», чип ADMIN, язык, уведомления, настройки, выход). 4 стат-карточки (всего пользователей / юристов / клиентов / активные консультации) + 2 карточки дохода. «Быстрые действия» (Пользователи / Юристы / Отчёты / Специализации — **все ссылки должны вести на реальные роуты**). «Последняя активность» (таблица). «Обзор системы» + «Состояние сервисов» — **реальные данные, а не статичные проценты**. API: admin/dashboard/stats, activity/recent.

**`/admin/users`** (создать роут) — список пользователей: фильтр по роли/поиск, пагинация, детали, блок/разблок (status). API: admin/users.

**`/admin/lawyers`** (создать роут) — модерация юристов: список (фильтр verified/поиск), одобрить/отклонить. API: admin/lawyers, approve, reject.

**`/admin/specializations`** — CRUD специализаций. 3 стат-карточки. Таблица (название/описание/кол-во юристов/статус/действия: toggle, редактировать, удалить). «Добавить» + диалоги. API: admin/specializations CRUD.

## КЛЮЧЕВЫЕ ПЕРЕИСПОЛЬЗУЕМЫЕ КОМПОНЕНТЫ

- **Layout** — обёртка клиентской зоны: баннер верификации email (resend), анимация страниц (Framer Motion), SupportFAB, MobileBottomNav, `<Outlet/>`.
- **ProtectedRoute** — guard по isAuthenticated + allowedRoles, редирект на дашборд роли.
- **BookingModal** — запись: тип (видео/чат), вопрос*, описание, дата* (min=завтра)/время (слоты), локальная валидация конфликтов. API: book.
- **OnboardingWizard** — 4 шага для нового юриста (использовать токены темы, не хардкод).
- **QuickAIChat** — мини-AI-чат на дашборде.
- **MobileBottomNav** — нижняя навигация (mobile), **разные наборы вкладок по роли** (клиент: Главная/Юристы/Записи/Документы/Профиль; юрист: Дашборд/Заявки/Календарь/Отзывы/Профиль; админ: Дашборд/Пользователи/Юристы/Специализации).
- **SupportFAB** — плавающая помощь (FAQ + форма обращения на бэкенд).
- **RatingDialog** — оценка (звёзды 1-5 + текст).
- **EmptyState** — универсальная пустышка (иконка/заголовок/подзаголовок/кнопка).
- **NotificationCenter** — колокол + бейдж непрочитанных, Popper-панель, автополлинг 30с.
- **LanguageSwitcher** — RU/UZ/EN (варианты buttons/dropdown).

## ЧТО ОБЯЗАТЕЛЬНО ИСПРАВИТЬ ОТНОСИТЕЛЬНО СТАРОЙ ВЕРСИИ

1. Удалить дубли страниц (Glass/не-Glass) и весь мёртвый код — одна страница = один файл.
2. Убрать все mock-данные из прода (профиль юриста, отзывы юриста, статистика/лог профиля клиента, статичные проценты в админке) — только реальный API.
3. Починить битую навигацию (админские quick-links, Settings/Profile для юриста/админа, MobileBottomNav по ролям).
4. Реализовать настоящий лендинг на `/` для гостей (сейчас редирект).
5. Подключить и реально применять тёмную тему + сохранять настройки на бэкенд.
6. Унифицировать флоу бронирования и завершения (эскроу в одной точке).
7. Унифицировать радиусы (8px) и имена типов уведомлений.
8. Привести LawyerReviewsPage к общей золотой теме.
9. Реальный `Help`, реальная запись о выводе средств, реальный weeklyActivity/responseRate.

## ТРЕБОВАНИЯ К КАЧЕСТВУ

- **Адаптивность mobile-first:** брейкпоинты xs/sm/md/lg; на xs стат-карточки 2 колонки, таблицы → карточки, фильтры → bottom-Drawer, min touch target 44px, инпуты 16px.
- **i18n:** все тексты через `t('...')`, 3 языка, фолбэк на RU.
- **Безопасность:** JWT, bcrypt, скрытие контактов юриста, фильтрация телефонов/email в чате, rate-limit, не отдавать stack trace в проде.
- **Логирование:** winston (error.log + combined.log), HTTP-middleware.
- **Доступность:** фокус-стили, aria, контраст.
- **Порядок сборки:** сначала backend (модели → auth → каждый домен API), затем frontend (тема → layout/роутинг → auth-страницы → дашборды → фичи), тестируй по мере готовности, не ломай рабочее.

Начинай. Если чего-то не хватает — принимай разумное решение сам и продолжай.

> **КОНЕЦ ПРОМПТА №1**

---
---

# ПРОМПТ №2 — МОБИЛЬНОЕ ПРИЛОЖЕНИЕ eMaslaXat

> Отдавай этот промпт после того, как веб-платформа и бэкенд готовы. Скопируй всё до пометки «КОНЕЦ ПРОМПТА №2».

---

## РОЛЬ

Ты — senior mobile-инженер (React Native / Expo) и продуктовый дизайнер. Построй нативное мобильное приложение **eMaslaXat** для iOS и Android, которое использует **тот же самый backend API**, что и веб-версия (та же модель данных, те же эндпоинты, тот же JWT). Не меняй бэкенд без крайней необходимости; если нужно — добавляй эндпоинты обратносовместимо.

## СТЕК МОБИЛЬНОГО ПРИЛОЖЕНИЯ

- **Expo (React Native) + TypeScript.**
- Навигация: **React Navigation** (Native Stack + Bottom Tabs + модальные стеки).
- Состояние/данные: **Redux Toolkit + React Query** (переиспользуй сервисный слой из веба, адаптировав `fetch`/axios под RN).
- Хранилище токена: **expo-secure-store** (JWT/role/user), НЕ localStorage.
- Реалтайм: **socket.io-client** (чат + сигналинг).
- Видеозвонки: **react-native-webrtc** (P2P; тот же Socket.io-сигналинг `join-room`/`signal`, комнаты `consultation:{id}`, STUN/TURN как в вебе). Если WebRTC на Expo Go недоступен — использовать **development build** (EAS).
- Файлы/камера: **expo-document-picker**, **expo-image-picker**, **expo-file-system** (загрузка документов и AI-анализ).
- Push-уведомления: **expo-notifications** (регистрировать токен, показывать бронирования/подтверждения/отзывы/старт звонка — маппинг на типы Notification из бэкенда).
- i18n: те же 3 языка (RU/UZ-кириллица/EN), персист в secure-store/AsyncStorage.
- Шрифт: **Inter** (expo-font).

## ДИЗАЙН (перенос веб-системы на нативный мобайл)

Держи ту же «тихую роскошь»: кремовый фон `#F5F1EB`, золото `#B8956E`, Inter, широкий трекинг и UPPERCASE у заголовков/кнопок, скругление 8, мягкие тени, флэт-стиль. Реализуй светлую и тёмную темы (тёмный фон `#1A1A1A`). Все токены палитры/типографики — те же, что в вебе (см. промпт №1). Минимальный тач-таргет 44pt. Нативные паттерны: bottom tab bar, свайпы, pull-to-refresh, bottom sheets (для фильтров/действий), safe-area, haptic feedback на ключевых действиях.

## НАВИГАЦИЯ ПО РОЛЯМ (Bottom Tabs)

**Гость (Auth-стек):** Onboarding-карусель (3-4 слайда о ценности) → Login → Register → Forgot/Reset Password → Verify Email.

**Клиент (Bottom Tabs):**
1. **Главная** — стат-карточки, QuickAIChat-виджет, быстрые действия, предстоящие консультации, онбординг-чеклист для новичков.
2. **AI-чат** — полноэкранный чат с историей (drawer/стек), чипы категорий права, вложения (камера/файл), «печатает», подходящие юристы под ответом.
3. **Юристы** — каталог: поиск, фильтры в **bottom sheet** (специализация/рейтинг/цена/опыт/сортировка), карточки, избранное, тап → профиль юриста (реальные данные, без контактов) → BookingModal (bottom sheet).
4. **Консультации** — табы Все/Предстоящие/Завершённые/Отменённые; карточки со статусом; «Видео»/«Чат»/«Отменить»/«Оценить».
5. **Профиль** — профиль/статистика, избранное, портфолио (досье), настройки (язык, тема, уведомления, безопасность), документы, помощь, выход.

**Юрист (Bottom Tabs):** Дашборд (заработок/клиенты/завершённые/доход, toggle online/offline) · Заявки (принять/отклонить) · Календарь (расписание) · Отзывы · Профиль (редактирование, баланс/вывод, настройки). Новому юристу — полноэкранный OnboardingWizard (4 шага).

**Админ (облегчённо):** Дашборд · Пользователи (блок/разблок) · Юристы (модерация approve/reject) · Специализации (CRUD). (Полноценную админку можно оставить в вебе; в приложении — базовый мониторинг/модерация.)

**Общие полноэкранные:** VideoCall (`/consultations/video/:id` аналог — react-native-webrtc, PiP, таймер, контролы микрофон/камера/динамик/завершить) и Chat (`/consultations/chat/:id` аналог — лента пузырей, «печатает», anti-обход фильтрация).

## ЭКРАНЫ (полный список = зеркало веб-страниц из промпта №1)

Guest: Onboarding-карусель, Login, Register, ForgotPassword, ResetPassword, VerifyEmail.
Клиент: Home(Dashboard), AIChat + ConversationHistory, Consultations(табы), Detail консультации, Lawyers(каталог), LawyerProfile, Documents + DocumentAICheck(bottom sheet), Favorites, Portfolio, Profile, EditProfile, Settings, ChangePassword, Notifications, Help/Support, Booking(bottom sheet).
Юрист: LawyerDashboard, OnboardingWizard, ConsultationRequests, Schedule, LawyerProfileEdit, Reviews, Balance/Withdraw, Notifications, Settings.
Админ: AdminDashboard, Users, LawyersModeration, Specializations.
Общие: VideoCall, ConsultationChat, RatingDialog(bottom sheet), NotificationsCenter.

Каждый экран — назначение, состав и данные те же, что описаны в промпте №1 (переиспользуй те описания). Разница только в подаче: списки — `FlatList` с pull-to-refresh и бесконечной пагинацией; модалки/фильтры/действия — bottom sheets; навигация — стек+табы; загрузка файлов — нативные пикеры; уведомления — push.

## КЛЮЧЕВЫЕ НАТИВНЫЕ ФЛОУ

- **Auth:** JWT в secure-store; авто-логин при старте (GET /auth/me); logout чистит secure-store.
- **Бронирование → оплата:** BookingModal (bottom sheet) → создание consultation `payment_pending` → открыть Payme checkout в **in-app browser** (expo-web-browser) → по возвращении опрашивать статус → уведомление.
- **Видеозвонок:** запрос permissions (камера/микрофон), react-native-webrtc, тот же Socket.io-сигналинг; поддержать фон/возврат, аудио-роутинг (динамик/наушник), завершение по обе стороны.
- **Push:** регистрация expo-push-token на бэкенде (добавь эндпоинт хранения токена в User, если его нет) → сервер шлёт push при событиях Notification → тап открывает нужный экран (deep link).
- **AI-лимиты/подписка:** показывать остаток бесплатных AI-запросов (free 3/день), апселл на basic/pro; апгрейд через Payme.
- **Офлайн/ошибки:** React Query кэш, скелетоны, тосты об ошибках, EmptyState на пустых списках.

## ТРЕБОВАНИЯ

- Полная поддержка iOS и Android, safe-area, тёмная тема, 3 языка.
- Единый визуальный язык с вебом (золото/крем/Inter/флэт).
- Переиспользовать сервисный слой и типы данных с бэкенда; **не дублировать бизнес-логику** — она на сервере.
- EAS build конфиг, иконка/сплэш в брендовых цветах, app.json с нужными permissions (камера, микрофон, уведомления, файлы).
- Начни с Auth + навигации по ролям + клиентского Home и AI-чата (ядро ценности), затем консультации/видео/чат, затем юрист/админ, затем оплата и push.

Начинай. Принимай разумные инженерные решения сам, держи паритет фич с веб-версией.

> **КОНЕЦ ПРОМПТА №2**

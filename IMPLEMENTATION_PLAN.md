# 🏛️ ПЛАН РЕАЛИЗАЦИИ ПЛАТФОРМЫ MASLAXAT

## 📊 EXECUTIVE SUMMARY

Полная реализация современной юридической платформы для Узбекистана с:
- AI-консультациями на базе GPT-4/Claude-3
- Видеоконсультациями с адвокатами
- Генерацией и проверкой документов
- Региональной системой (14 регионов)
- Платежами через Payme, Click, Uzcard
- Голосовыми сообщениями
- Рейтинговой системой

---

## 🎨 ЧАСТЬ 1: ДИЗАЙН-СИСТЕМА И UX

### 1.1 Цветовая палитра (профессиональная юридическая)

```javascript
// PRIMARY COLORS - Юридическая надежность
const colors = {
  primary: {
    navy: '#1a365d',      // Основной темно-синий
    blue: '#2d4a7c',      // Светлый синий
    midnight: '#0f2342',  // Темный для акцентов
  },
  secondary: {
    gold: '#d4af37',      // Премиум золото
    lightGold: '#f0d875', // Светлое золото
    darkGold: '#aa8a2e',  // Темное золото
  },
  accent: {
    success: '#10b981',   // Успех (зеленый)
    warning: '#f59e0b',   // Предупреждение (оранжевый)
    error: '#ef4444',     // Ошибка (красный)
    info: '#3b82f6',      // Информация (голубой)
  },
  neutral: {
    white: '#ffffff',
    gray50: '#f9fafb',
    gray100: '#f3f4f6',
    gray200: '#e5e7eb',
    gray300: '#d1d5db',
    gray800: '#1f2937',
    black: '#111827',
  }
};
```

### 1.2 Типографика

```javascript
const typography = {
  fonts: {
    heading: '"Inter", "SF Pro Display", -apple-system, sans-serif',
    body: '"Inter", "SF Pro Text", -apple-system, sans-serif',
    code: '"JetBrains Mono", "Fira Code", monospace',
  },
  sizes: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem',// 30px
    '4xl': '2.25rem', // 36px
    '5xl': '3rem',    // 48px
  }
};
```

### 1.3 Анимации и микроинтеракции

```javascript
const animations = {
  // Плавное появление элементов
  fadeIn: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: 'easeOut' }
  },

  // Увеличение при наведении
  scaleOnHover: {
    whileHover: { scale: 1.02 },
    whileTap: { scale: 0.98 },
    transition: { type: 'spring', stiffness: 400, damping: 17 }
  },

  // Волновой эффект
  ripple: {
    initial: { scale: 0, opacity: 1 },
    animate: { scale: 2, opacity: 0 },
    transition: { duration: 0.6 }
  },

  // Скелетон загрузки
  skeleton: {
    animate: {
      backgroundPosition: ['200% 0', '-200% 0'],
    },
    transition: {
      repeat: Infinity,
      duration: 1.5,
      ease: 'linear'
    }
  }
};
```

### 1.4 Ключевые UI компоненты

#### Карточки адвокатов (с анимацией)
- Фото с эффектом overlay при наведении
- Плавное появление видеовизитки
- Анимация звезд рейтинга
- Пульсирующий индикатор "онлайн"

#### Чат с AI
- Typing indicator с анимацией точек
- Плавная прокрутка к новым сообщениям
- Анимация появления ответов
- Подсветка синтаксиса для юридических ссылок

#### Видеоконсультация
- Picture-in-Picture режим
- Индикаторы качества связи
- Таймер с визуальным прогресс-баром
- Эффекты размытия фона

---

## 🏗️ ЧАСТЬ 2: АРХИТЕКТУРА BACKEND

### 2.1 Микросервисная архитектура

```
┌─────────────────────────────────────────────────────────┐
│                     API GATEWAY (Port 8080)              │
│              Rate Limiting • Auth • Routing              │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────┼───────────┬──────────┐
        │           │           │          │
┌───────▼─────┐ ┌──▼────┐ ┌────▼───┐ ┌────▼────┐
│Auth Service │ │AI      │ │Video   │ │Payment  │
│Port: 3001   │ │Service │ │Service │ │Service  │
│             │ │3005    │ │3003    │ │3004     │
│• JWT        │ │• GPT-4 │ │• WebRTC│ │• Payme  │
│• 2FA        │ │• Claude│ │• Record│ │• Click  │
│• OAuth      │ │• Lex.uz│ │• P2P   │ │• Uzcard │
└─────────────┘ └────────┘ └────────┘ └─────────┘
```

### 2.2 Структура базы данных

```sql
-- USERS TABLE (клиенты и адвокаты)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  role ENUM('client', 'lawyer', 'admin'),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255),
  full_name VARCHAR(255),
  avatar_url TEXT,
  region_id INT REFERENCES regions(id),
  language ENUM('uz', 'ru', 'en') DEFAULT 'uz',
  balance DECIMAL(10,2) DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- LAWYER_PROFILES
CREATE TABLE lawyer_profiles (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  license_number VARCHAR(100),
  license_date DATE,
  education TEXT,
  specializations JSONB, -- ['family', 'criminal', 'civil']
  experience_years INT,
  bio TEXT,
  video_intro_url TEXT,
  social_links JSONB,
  rating DECIMAL(3,2) DEFAULT 0,
  reviews_count INT DEFAULT 0,
  hourly_rate DECIMAL(10,2),
  is_available BOOLEAN DEFAULT true
);

-- CONSULTATIONS (видеоконсультации)
CREATE TABLE consultations (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES users(id),
  lawyer_id UUID REFERENCES users(id),
  legal_area VARCHAR(50),
  problem_description TEXT,
  voice_message_url TEXT,
  scheduled_at TIMESTAMP,
  duration INT, -- минуты
  status ENUM('pending', 'confirmed', 'completed', 'cancelled'),
  price DECIMAL(10,2),
  recording_url TEXT,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- AI_CONVERSATIONS
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  legal_area VARCHAR(50),
  messages JSONB, -- [{role: 'user', content: '...'}, ...]
  total_tokens INT,
  cost DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- DOCUMENTS
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  type ENUM('contract', 'complaint', 'lawsuit', 'application'),
  legal_area VARCHAR(50),
  template_data JSONB,
  generated_url TEXT,
  status ENUM('draft', 'generated', 'reviewed'),
  created_at TIMESTAMP DEFAULT NOW()
);

-- TRANSACTIONS
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  type ENUM('consultation', 'ai_chat', 'document', 'subscription'),
  amount DECIMAL(10,2),
  platform_fee DECIMAL(10,2),
  payment_method ENUM('payme', 'click', 'uzcard', 'card'),
  status ENUM('pending', 'completed', 'failed', 'refunded'),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- REGIONS (14 регионов Узбекистана)
CREATE TABLE regions (
  id SERIAL PRIMARY KEY,
  name_uz VARCHAR(100),
  name_ru VARCHAR(100),
  name_en VARCHAR(100),
  code VARCHAR(10)
);
```

### 2.3 API Endpoints

#### AUTH SERVICE
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/verify-otp
POST   /api/auth/refresh-token
GET    /api/auth/me
PUT    /api/auth/profile
```

#### AI SERVICE
```
POST   /api/ai/chat/create
POST   /api/ai/chat/{id}/message
GET    /api/ai/chat/{id}/history
POST   /api/ai/detect-legal-area
POST   /api/ai/transcribe-voice
```

#### LAWYER SERVICE
```
GET    /api/lawyers/search
GET    /api/lawyers/{id}
GET    /api/lawyers/{id}/availability
POST   /api/lawyers/{id}/book
PUT    /api/lawyers/profile
POST   /api/lawyers/video-intro
GET    /api/lawyers/earnings
```

#### CONSULTATION SERVICE
```
POST   /api/consultations/create
GET    /api/consultations/{id}
GET    /api/consultations/upcoming
GET    /api/consultations/history
PUT    /api/consultations/{id}/rate
GET    /api/consultations/{id}/recording
```

#### DOCUMENT SERVICE
```
POST   /api/documents/generate
POST   /api/documents/check
GET    /api/documents/{id}
GET    /api/documents/templates
PUT    /api/documents/{id}/revise
```

#### PAYMENT SERVICE
```
POST   /api/payments/create
POST   /api/payments/payme/callback
POST   /api/payments/click/callback
POST   /api/payments/uzcard/callback
GET    /api/payments/history
POST   /api/payouts/request
```

#### VIDEO SERVICE
```
POST   /api/video/room/create
GET    /api/video/room/{id}/token
POST   /api/video/room/{id}/start-recording
POST   /api/video/room/{id}/stop-recording
```

---

## 🎯 ЧАСТЬ 3: FRONTEND СТРУКТУРА

### 3.1 Структура проекта

```
frontend/
├── src/
│   ├── components/
│   │   ├── common/
│   │   │   ├── Button/
│   │   │   ├── Card/
│   │   │   ├── Modal/
│   │   │   ├── Input/
│   │   │   ├── Avatar/
│   │   │   ├── Badge/
│   │   │   ├── Skeleton/
│   │   │   └── animations/
│   │   │       ├── FadeIn.jsx
│   │   │       ├── SlideIn.jsx
│   │   │       ├── Ripple.jsx
│   │   │       └── Pulse.jsx
│   │   │
│   │   ├── layout/
│   │   │   ├── Header/
│   │   │   ├── Sidebar/
│   │   │   ├── Footer/
│   │   │   └── Navigation/
│   │   │
│   │   ├── features/
│   │   │   ├── AIChat/
│   │   │   │   ├── ChatInterface.jsx
│   │   │   │   ├── MessageBubble.jsx
│   │   │   │   ├── VoiceRecorder.jsx
│   │   │   │   └── TypingIndicator.jsx
│   │   │   │
│   │   │   ├── LawyerCatalog/
│   │   │   │   ├── LawyerCard.jsx
│   │   │   │   ├── LawyerProfile.jsx
│   │   │   │   ├── VideoIntro.jsx
│   │   │   │   ├── RatingStars.jsx
│   │   │   │   └── BookingCalendar.jsx
│   │   │   │
│   │   │   ├── VideoCall/
│   │   │   │   ├── VideoRoom.jsx
│   │   │   │   ├── Controls.jsx
│   │   │   │   ├── Timer.jsx
│   │   │   │   └── RecordingIndicator.jsx
│   │   │   │
│   │   │   ├── Documents/
│   │   │   │   ├── DocumentGenerator.jsx
│   │   │   │   ├── DocumentViewer.jsx
│   │   │   │   ├── TemplateSelector.jsx
│   │   │   │   └── PDFExporter.jsx
│   │   │   │
│   │   │   └── Payments/
│   │   │       ├── PaymentModal.jsx
│   │   │       ├── PaymeButton.jsx
│   │   │       ├── ClickButton.jsx
│   │   │       └── PaymentHistory.jsx
│   │   │
│   │   └── dashboard/
│   │       ├── ClientDashboard/
│   │       ├── LawyerDashboard/
│   │       └── AdminDashboard/
│   │
│   ├── pages/
│   │   ├── Home/
│   │   ├── Auth/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   └── VerifyOTP.jsx
│   │   ├── Dashboard/
│   │   ├── Lawyers/
│   │   ├── Consultations/
│   │   ├── AIConsult/
│   │   ├── Documents/
│   │   ├── Profile/
│   │   └── Settings/
│   │
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useWebRTC.js
│   │   ├── useVoiceRecorder.js
│   │   ├── usePayment.js
│   │   ├── useAnimation.js
│   │   └── useI18n.js
│   │
│   ├── services/
│   │   ├── api/
│   │   │   ├── auth.js
│   │   │   ├── lawyers.js
│   │   │   ├── consultations.js
│   │   │   ├── ai.js
│   │   │   ├── documents.js
│   │   │   └── payments.js
│   │   │
│   │   ├── webrtc/
│   │   │   └── videoService.js
│   │   │
│   │   └── voice/
│   │       └── speechRecognition.js
│   │
│   ├── store/
│   │   ├── slices/
│   │   │   ├── authSlice.js
│   │   │   ├── lawyersSlice.js
│   │   │   ├── consultationsSlice.js
│   │   │   ├── aiChatSlice.js
│   │   │   └── paymentsSlice.js
│   │   └── store.js
│   │
│   ├── utils/
│   │   ├── constants.js
│   │   ├── formatters.js
│   │   ├── validators.js
│   │   └── helpers.js
│   │
│   └── locales/
│       ├── uz.json
│       ├── ru.json
│       └── en.json
```

---

## 🚀 ЧАСТЬ 4: КЛЮЧЕВЫЕ ФИЧИ С АНИМАЦИЯМИ

### 4.1 AI-Консультация (интерактивный чат)

**Анимации:**
- Typing indicator с тремя прыгающими точками
- Плавное появление сообщений снизу вверх
- Пульсация микрофона при записи голоса
- Волновая анимация при обработке голоса

**Функции:**
- Распознавание голоса (узбекский/русский)
- Определение области права по описанию
- Ссылки на Lex.uz с подсветкой
- История чата с поиском

### 4.2 Каталог адвокатов (premium experience)

**Анимации:**
- Карточки появляются с эффектом "волны"
- При наведении - плавное увеличение + shadow
- Звезды рейтинга заполняются анимированно
- Индикатор "онлайн" пульсирует

**Фильтры:**
- Регион (с картой Узбекистана)
- Специализация
- Рейтинг
- Цена
- Доступность

### 4.3 Видеоконсультация (WebRTC)

**Анимации:**
- Countdown 3-2-1 перед началом
- Таймер с круговым прогресс-баром
- Индикатор качества связи (зеленый/желтый/красный)
- Эффект размытия фона

**Функции:**
- Picture-in-Picture
- Запись (с согласия клиента)
- Чат в реальном времени
- Демонстрация экрана
- Отправка файлов

### 4.4 Генерация документов

**Анимации:**
- Прогресс-бар генерации
- Анимация печатной машинки для текста
- Конфетти при успешной генерации
- Плавное появление предпросмотра

**Шаблоны:**
- Исковые заявления
- Договоры (купля-продажа, аренда, трудовой)
- Претензии
- Жалобы
- Доверенности
- Заявления в госорганы

---

## 💳 ЧАСТЬ 5: ПЛАТЕЖНАЯ СИСТЕМА

### 5.1 Интеграция платежных систем

**Payme:**
```javascript
// Merchant ID и токен
const payme = {
  merchantId: process.env.PAYME_MERCHANT_ID,
  testMode: true,
  callback: '/api/payments/payme/callback'
};

// Создание платежа
POST https://checkout.paycom.uz/api
{
  "method": "cards.create",
  "params": {
    "card": {
      "number": "8600...",
      "expire": "0399"
    },
    "amount": 35000000, // в тийинах (350 000 сум)
    "account": {
      "user_id": "uuid"
    }
  }
}
```

**Click:**
```javascript
const click = {
  merchantId: process.env.CLICK_MERCHANT_ID,
  serviceId: process.env.CLICK_SERVICE_ID,
  callback: '/api/payments/click/callback'
};
```

**Uzcard:**
```javascript
const uzcard = {
  merchantId: process.env.UZCARD_MERCHANT_ID,
  terminalId: process.env.UZCARD_TERMINAL_ID
};
```

### 5.2 Тарифы

```javascript
const pricing = {
  aiConsultation: {
    basic: 15000,      // 15,000 сум за сессию
    unlimited: 50000   // 50,000 сум/месяц безлимит
  },

  documentGeneration: {
    simple: 25000,     // Простые (заявления)
    medium: 50000,     // Средние (договоры)
    complex: 100000    // Сложные (иски)
  },

  documentCheck: {
    perPage: 5000      // 5,000 сум за страницу
  },

  videoConsultation: {
    // Адвокат устанавливает сам
    // Комиссия платформы: 30-40%
  }
};
```

---

## 📱 ЧАСТЬ 6: МОБИЛЬНОЕ ПРИЛОЖЕНИЕ

### 6.1 React Native структура

```
mobile/
├── src/
│   ├── screens/
│   ├── components/
│   ├── navigation/
│   ├── services/
│   ├── hooks/
│   └── utils/
```

### 6.2 Особенности

- Нативные уведомления (FCM)
- Биометрическая аутентификация
- Офлайн-режим для документов
- Оптимизация для слабых соединений
- Поддержка темной темы

---

## 🔒 ЧАСТЬ 7: БЕЗОПАСНОСТЬ

### 7.1 Аутентификация

```javascript
// JWT токены
const tokens = {
  access: {
    expiresIn: '15m',
    secret: process.env.JWT_SECRET
  },
  refresh: {
    expiresIn: '30d',
    secret: process.env.JWT_REFRESH_SECRET
  }
};

// 2FA (опционально для адвокатов)
const twoFactor = {
  method: 'totp', // Time-based OTP
  issuer: 'MaslaXat'
};
```

### 7.2 Шифрование

- TLS 1.3 для всех соединений
- End-to-end шифрование для видеозвонков
- AES-256 для хранения документов
- Хэширование паролей (bcrypt, rounds=12)

---

## 📊 ЧАСТЬ 8: АНАЛИТИКА

### 8.1 Метрики для админа

```javascript
const analytics = {
  revenue: {
    total: 'Общий доход',
    byPeriod: 'По периодам',
    byService: 'По типам услуг',
    byRegion: 'По регионам'
  },

  users: {
    total: 'Всего пользователей',
    active: 'Активных',
    newByPeriod: 'Новые по периодам',
    retention: 'Retention rate'
  },

  lawyers: {
    total: 'Всего адвокатов',
    verified: 'Верифицированных',
    topRated: 'Топ по рейтингу',
    earnings: 'Заработок адвокатов'
  },

  consultations: {
    total: 'Всего консультаций',
    completed: 'Завершенных',
    avgDuration: 'Средняя продолжительность',
    avgRating: 'Средний рейтинг'
  }
};
```

---

## 🌐 ЧАСТЬ 9: МУЛЬТИЯЗЫЧНОСТЬ

### 9.1 i18n конфигурация

```javascript
// locales/uz.json
{
  "common": {
    "welcome": "Xush kelibsiz",
    "login": "Kirish",
    "register": "Ro'yxatdan o'tish"
  },
  "services": {
    "aiConsult": "AI maslahat",
    "videoCall": "Video konsultatsiya",
    "document": "Hujjat tuzish"
  },
  "legalAreas": {
    "family": "Oila huquqi",
    "criminal": "Jinoyat huquqi",
    "civil": "Fuqarolik huquqi",
    "labor": "Mehnat huquqi",
    "corporate": "Korporativ huquq"
  }
}
```

---

## 🎯 ЧАСТЬ 10: ЭТАПЫ РАЗРАБОТКИ

### ФАЗА 1: MVP (2-3 месяца)
- ✅ Регистрация/Авторизация
- ✅ AI-консультации (базовые)
- ✅ Каталог адвокатов
- ✅ Бронирование консультаций
- ✅ Видеозвонки (без записи)
- ✅ Платежи (Payme)
- ✅ Базовый админ

### ФАЗА 2: РАСШИРЕНИЕ (1-2 месяца)
- ⏳ Видеовизитки адвокатов
- ⏳ Запись консультаций
- ⏳ Рейтинги и отзывы
- ⏳ Голосовые сообщения
- ⏳ Региональная система
- ⏳ Click, Uzcard
- ⏳ Расширенная аналитика

### ФАЗА 3: ПРЕМИУМ (1-2 месяца)
- 📋 Генерация документов
- 📋 Проверка документов
- 📋 Подписки
- 📋 Срочные консультации
- 📋 Чат клиент-адвокат
- 📋 Хранилище документов
- 📋 Реферальная программа

### ФАЗА 4: ИНТЕГРАЦИИ (1 месяц)
- 🔄 Интеграция с Lex.uz
- 🔄 База знаний
- 🔄 Уведомления о сроках
- 🔄 Экспорт в OneID
- 🔄 Мобильное приложение

---

## 📈 ОЦЕНКА РЕСУРСОВ

### Команда:
- 1 Backend Lead (Node.js/Python)
- 2 Backend developers
- 1 Frontend Lead (React)
- 2 Frontend developers
- 1 Mobile developer (React Native)
- 1 UI/UX designer
- 1 DevOps engineer
- 1 QA engineer
- 1 Product Manager

### Инфраструктура:
- AWS/DigitalOcean VPS
- PostgreSQL (основная БД)
- Redis (кэш, очереди)
- S3-совместимое хранилище
- Twilio/Agora для видео
- OpenAI API
- Anthropic API (Claude)

### Бюджет (ориентировочно):
- Разработка: $50,000 - $80,000
- Инфраструктура: $500 - $1,000/месяц
- API сервисы: $300 - $500/месяц
- Прочее: $5,000

---

## 🎨 ЧАСТЬ 11: UI/UX ДЕТАЛИ

### Главная страница (Landing)

**Секция Hero:**
```
┌────────────────────────────────────────────┐
│  [LOGO] MaslaXat    [Услуги] [Адвокаты]   │
│                                [Войти]     │
├────────────────────────────────────────────┤
│                                            │
│   ⚖️                                        │
│   Юридическая помощь                       │
│   онлайн 24/7                             │
│                                            │
│   [Начать консультацию с AI]              │
│   [Найти адвоката]                        │
│                                            │
│   ✨ Анимация: плавающие иконки закона     │
└────────────────────────────────────────────┘
```

**Анимация:**
- Параллакс эффект при скролле
- Floating icons (молоток, весы, документы)
- Gradient background с анимацией
- Typing effect для текста

### Dashboard клиента

```
┌─────────────────────────────────────────────────────┐
│  ⚖️ MaslaXat    🔔(5)  👤 [Имя]  🚪              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Добро пожаловать, [Имя]! 👋                       │
│  У вас 3 консультации и 2 документа                │
│                                                     │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐          │
│  │ 📹  3 │ │ 📄 12 │ │ ⚖️ 45 │ │ 🔔  5 │          │
│  │Консул.│ │ Док-ты│ │Юристы │ │Уведом.│          │
│  └───────┘ └───────┘ └───────┘ └───────┘          │
│  ⬆️ Анимация: появление по очереди с задержкой     │
│                                                     │
│  Быстрые действия:                                 │
│  ┌──────────────┐ ┌──────────────┐                │
│  │ 📹 Новая     │ │ 📄 Документы │                │
│  │ консультация │ │              │                │
│  └──────────────┘ └──────────────┘                │
│  ⬆️ Hover: scale + shadow                          │
│                                                     │
│  Предстоящие консультации:                         │
│  ┌─────────────────────────────────────┐          │
│  │ 👨‍⚖️ Иванов И.И. • Гражданское      │          │
│  │ 📅 Сегодня, 15:00                   │          │
│  │ [✅ Подтверждено]  [Войти]         │          │
│  └─────────────────────────────────────┘          │
│  ⬆️ Pulsing badge для "Войти"                      │
└─────────────────────────────────────────────────────┘
```

### Каталог адвокатов

```
Фильтры (sidebar):
┌─────────────────┐
│ 📍 Регион       │
│ ☑️ Ташкент      │
│ ☐ Самарканд    │
│ ...             │
│                 │
│ ⚖️ Специализация│
│ ☑️ Семейное     │
│ ☐ Уголовное    │
│ ...             │
│                 │
│ ⭐ Рейтинг      │
│ [====|----] 4+  │
│                 │
│ 💰 Цена         │
│ [50K - 500K]    │
└─────────────────┘

Карточки адвокатов (grid):
┌──────────────────────┐ ┌──────────────────────┐
│ [Фото с overlay]     │ │ [Фото с overlay]     │
│ 🟢 Онлайн            │ │ ⚪ Офлайн            │
│                      │ │                      │
│ Иванов Иван         │ │ Петрова Мария       │
│ ⭐⭐⭐⭐⭐ (156)      │ │ ⭐⭐⭐⭐☆ (89)       │
│                      │ │                      │
│ Семейное право      │ │ Корпоративное       │
│ 15 лет опыта        │ │ 8 лет опыта         │
│                      │ │                      │
│ от 250,000 сум/час  │ │ от 350,000 сум/час  │
│                      │ │                      │
│ [🎥 Видеовизитка]   │ │ [🎥 Видеовизитка]   │
│ [Записаться]        │ │ [Записаться]        │
└──────────────────────┘ └──────────────────────┘
⬆️ Hover: поднятие карточки + усиление тени
```

### AI-Чат консультация

```
┌─────────────────────────────────────────────────┐
│ 🤖 AI Юридический консультант                   │
│                              [🔊 Голос] [❌]    │
├─────────────────────────────────────────────────┤
│                                                 │
│  🤖: Здравствуйте! Опишите вашу проблему       │
│      Я помогу определить область права         │
│      ⬆️ Fade in анимация                        │
│                                                 │
│                         👤: У меня вопрос      │
│                             по наследству      │
│                             ⬆️ Slide from right │
│                                                 │
│  🤖: [... анализирую ...]                      │
│      ● ● ●  ⬅️ Анимированные точки            │
│                                                 │
│  🤖: Это относится к Наследственному праву     │
│      Согласно ГК РУз, статья 1110...          │
│      [📖 Читать на Lex.uz]                     │
│      ⬆️ Typewriter effect                      │
│                                                 │
│  [🎤 Записать голосом] или [⌨️ Написать]       │
│  ⬆️ Микрофон пульсирует при записи             │
└─────────────────────────────────────────────────┘
```

### Видеоконсультация

```
┌─────────────────────────────────────────────────┐
│ [Адвокат - большое видео]                       │
│                                                 │
│               [PiP: Вы]                         │
│                                                 │
│ ┌─ Overlay controls (hover) ──────────────┐    │
│ │ [🔇] [🎥] [📺] [💬] [⏸️]     [❌]       │    │
│ │                                          │    │
│ │ ⏱️ 23:15 / 60:00                         │    │
│ │ [████████████░░░░░░░░░] 38%            │    │
│ │                                          │    │
│ │ 🔴 Запись включена                      │    │
│ │ 📶 Отличное соединение                  │    │
│ └──────────────────────────────────────────┘    │
│ ⬆️ Автоскрытие через 3 сек бездействия         │
│                                                 │
│ [Чат sidebar - опционально]                    │
└─────────────────────────────────────────────────┘

За 5 минут до конца:
⬇️ Toast notification с countdown
┌──────────────────────────────────┐
│ ⏰ Осталось 5 минут               │
│ [Продлить консультацию]          │
└──────────────────────────────────┘
```

### Генератор документов

```
Step-by-step wizard:

Шаг 1: Выбор типа
┌─────────────────────────────────────┐
│ Какой документ нужен?               │
│                                     │
│ ┌───────┐ ┌───────┐ ┌───────┐      │
│ │ 📋    │ │ 📃    │ │ ⚖️     │      │
│ │ Иск   │ │Договор│ │Претензия│    │
│ └───────┘ └───────┘ └───────┘      │
│ ⬆️ Выбранная карточка подсвечивается│
│                                     │
│           [Далее →]                 │
└─────────────────────────────────────┘

Шаг 2: Заполнение данных
┌─────────────────────────────────────┐
│ Исковое заявление                   │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━         │
│ Прогресс: 3/5 шагов                │
│                                     │
│ ФИО истца:                          │
│ [________________]                  │
│ ⬆️ Анимированный placeholder        │
│                                     │
│ Адрес:                              │
│ [________________]                  │
│                                     │
│ Требования:                         │
│ [____________________________]      │
│ [____________________________]      │
│                                     │
│ [← Назад]        [Далее →]         │
└─────────────────────────────────────┘

Шаг 3: Генерация
┌─────────────────────────────────────┐
│ Генерируем документ...              │
│                                     │
│ [████████████░░░░░░░] 75%          │
│                                     │
│ ✍️ Подготовка текста...            │
│ ⬆️ Typewriter animation             │
└─────────────────────────────────────┘

Шаг 4: Результат
┌─────────────────────────────────────┐
│ ✅ Документ готов! 🎉               │
│ ⬆️ Confetti animation               │
│                                     │
│ [Предпросмотр PDF]                 │
│ ┌─────────────────┐                │
│ │ [PDF preview]   │                │
│ │                 │                │
│ └─────────────────┘                │
│                                     │
│ [⬇️ Скачать PDF]                   │
│ [⬇️ Скачать DOCX]                  │
│ [✉️ Отправить на email]            │
└─────────────────────────────────────┘
```

---

## 🎨 ЧАСТЬ 12: АНИМАЦИИ В ДЕТАЛЯХ

### Micro-interactions

**1. Кнопки:**
```css
.button {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.button:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(26, 54, 93, 0.2);
}

.button:active {
  transform: translateY(0);
}

/* Ripple effect */
@keyframes ripple {
  to {
    transform: scale(4);
    opacity: 0;
  }
}
```

**2. Карточки:**
```css
.card {
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 20px 40px rgba(0,0,0,0.15);
}
```

**3. Рейтинг (звезды):**
```javascript
// Последовательное заполнение звезд
stars.forEach((star, index) => {
  setTimeout(() => {
    star.classList.add('filled');
  }, index * 100);
});
```

**4. Loading скелетоны:**
```css
@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}

.skeleton {
  animation: shimmer 2s infinite linear;
  background: linear-gradient(
    to right,
    #f0f0f0 0%,
    #e0e0e0 20%,
    #f0f0f0 40%,
    #f0f0f0 100%
  );
  background-size: 1000px 100%;
}
```

**5. Notifications (Toast):**
```javascript
// Slide in from top
{
  initial: { y: -100, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -100, opacity: 0 },
  transition: { type: 'spring', stiffness: 500, damping: 30 }
}
```

---

## 🔄 ЧАСТЬ 13: REAL-TIME FEATURES

### WebSocket события

```javascript
// Client -> Server
const socketEvents = {
  // Видеоконсультация
  'consultation:join': { roomId, userId },
  'consultation:leave': { roomId, userId },
  'consultation:message': { roomId, message },

  // Уведомления
  'notification:read': { notificationId },

  // Онлайн статус
  'user:online': { userId },
  'user:offline': { userId },

  // Typing indicator
  'chat:typing': { roomId, userId }
};

// Server -> Client
const serverEvents = {
  'consultation:started': { roomId, startTime },
  'consultation:ended': { roomId, duration },
  'notification:new': { notification },
  'lawyer:status': { lawyerId, isOnline },
  'chat:message': { message }
};
```

---

## 📊 ЧАСТЬ 14: АНАЛИТИКА DASHBOARD

### Для администратора

```javascript
const adminDashboard = {
  kpis: [
    {
      title: 'Общий доход',
      value: '25,450,000 сум',
      change: '+12.5%',
      trend: 'up',
      icon: '💰',
      color: '#10b981'
    },
    {
      title: 'Активные пользователи',
      value: '1,234',
      change: '+8.2%',
      trend: 'up',
      icon: '👥',
      color: '#3b82f6'
    },
    {
      title: 'Консультаций',
      value: '456',
      change: '-3.1%',
      trend: 'down',
      icon: '📹',
      color: '#f59e0b'
    },
    {
      title: 'Ср. рейтинг',
      value: '4.8',
      change: '+0.2',
      trend: 'up',
      icon: '⭐',
      color: '#d4af37'
    }
  ],

  charts: [
    {
      type: 'line',
      title: 'Доход по месяцам',
      data: [/* ... */]
    },
    {
      type: 'bar',
      title: 'Услуги по типам',
      data: [/* ... */]
    },
    {
      type: 'pie',
      title: 'Распределение по регионам',
      data: [/* ... */]
    },
    {
      type: 'area',
      title: 'Новые пользователи',
      data: [/* ... */]
    }
  ]
};
```

### Графики с анимацией

```javascript
// Использование Chart.js с анимацией
const chartOptions = {
  animation: {
    duration: 1000,
    easing: 'easeInOutQuart',
    onProgress: function(animation) {
      // Анимация значений
    }
  },
  elements: {
    line: {
      tension: 0.4 // Smooth curves
    },
    point: {
      radius: 5,
      hoverRadius: 7,
      hitRadius: 30
    }
  }
};
```

---

## 🎯 ЗАКЛЮЧЕНИЕ

Это **идеальный план** для создания профессиональной юридической платформы MaslaXat с:

✅ **Современным дизайном** - premium UI/UX с анимациями
✅ **Полным функционалом** - все фичи из ТЗ
✅ **Масштабируемой архитектурой** - микросервисы
✅ **Безопасностью** - шифрование, JWT, 2FA
✅ **Платежами** - Payme, Click, Uzcard
✅ **AI интеграцией** - GPT-4, Claude-3
✅ **Видеозвонками** - WebRTC с записью
✅ **Мультиязычностью** - узбекский, русский, английский
✅ **Региональностью** - 14 регионов Узбекистана
✅ **Аналитикой** - детальная статистика

**Следующий шаг:** Начать разработку с MVP (Фаза 1)

Готов приступить к реализации! 🚀

const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

// ─── USER MODEL ─────────────────────────────────────────────
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { isEmail: true },
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  phone: {
    type: DataTypes.STRING,
  },
  address: {
    type: DataTypes.STRING,
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  role: {
    type: DataTypes.ENUM('client', 'lawyer', 'admin'),
    defaultValue: 'client',
  },
  avatar: {
    type: DataTypes.STRING,
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  legalAcceptedAt: { type: DataTypes.DATE },
  legalVersion: { type: DataTypes.STRING },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  resetToken: {
    type: DataTypes.STRING,
  },
  resetTokenExpiry: {
    type: DataTypes.DATE,
  },
  verificationToken: {
    type: DataTypes.STRING,
  },
  // Момент смены пароля — токены, выданные ДО него, отклоняются (сброс пароля
  // при компрометации выкидывает старые сессии).
  passwordChangedAt: {
    type: DataTypes.DATE,
  },
  // Соц-вход: идентификаторы провайдеров (заполняются при первом входе)
  googleId: {
    type: DataTypes.STRING,
  },
  telegramId: {
    type: DataTypes.STRING,
  },
  // Двухфакторная аутентификация (TOTP). secret — base32; включается только
  // после подтверждения кодом. Резервные коды хранятся хешами (sha256).
  twoFactorSecret: {
    type: DataTypes.STRING,
  },
  twoFactorEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  twoFactorBackupCodes: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
}, {
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        user.password = await bcrypt.hash(user.password, 12);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 12);
      }
    },
  },
  indexes: [{ name: 'users_email_key', unique: true, fields: ['email'] }],
});

User.prototype.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

User.prototype.toJSON = function () {
  const values = { ...this.get() };
  delete values.password;
  delete values.resetToken;
  delete values.resetTokenExpiry;
  delete values.verificationToken;
  // Секрет и резервные коды 2FA не отдаём наружу никогда; флаг enabled — можно
  delete values.twoFactorSecret;
  delete values.twoFactorBackupCodes;
  return values;
};

// ─── LAWYER PROFILE MODEL ───────────────────────────────────
const LawyerProfile = sequelize.define('LawyerProfile', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  // Основная специализация (для обратной совместимости: = specializations[0]).
  // Каталог/карточка исторически читают это поле; держим синхронно с массивом.
  specialization: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // Все специализации юриста (мультивыбор). Источник истины; specialization = первая.
  specializations: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: [],
  },
  description: {
    type: DataTypes.TEXT,
  },
  // Автоприветствие: авто-сообщение юриста при открытии чата (если сообщений ещё нет)
  greeting: {
    type: DataTypes.TEXT,
  },
  professionalTitle: { type: DataTypes.STRING(180) },
  region: { type: DataTypes.STRING(120) },
  linkedinUrl: { type: DataTypes.TEXT },
  licenseNumber: { type: DataTypes.STRING(120) },
  licenseIssuer: { type: DataTypes.STRING(255) },
  licenseIssuedAt: { type: DataTypes.DATEONLY },
  licenseExpiresAt: { type: DataTypes.DATEONLY },
  timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'Asia/Tashkent' },
  consultationFormats: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: false,
    defaultValue: ['chat', 'audio', 'webrtc'],
  },
  consultationDurations: {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    allowNull: false,
    defaultValue: [30, 60, 90],
  },
  onboardingStep: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  verificationSubmittedAt: { type: DataTypes.DATE },
  experience: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  price: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  rating: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  reviewsCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  completedCases: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  location: {
    type: DataTypes.STRING,
  },
  languages: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: ['uz', 'ru'],
  },
  education: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  certificates: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  schedule: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  isAvailable: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  balance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  pendingBalance: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  // Модерация юриста админом (отдельно от User.isVerified — тот про подтверждение email).
  // pending → на проверке (в каталоге НЕ виден, бронировать нельзя);
  // approved → одобрен админом (виден, бронируется, галочка «Проверенный»);
  // rejected → отклонён (с причиной в rejectionReason), может подать снова.
  verificationStatus: {
    type: DataTypes.ENUM('draft', 'pending_review', 'approved', 'rejected', 'suspended'),
    defaultValue: 'draft',
  },
  // Причина отклонения — показывается юристу, чтобы он исправил и подал снова.
  rejectionReason: {
    type: DataTypes.TEXT,
  },
});

// ─── CONSULTATION MODEL ─────────────────────────────────────
const Consultation = sequelize.define('Consultation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  type: {
    type: DataTypes.ENUM('video', 'chat', 'phone'),
    defaultValue: 'video',
  },
  status: {
    type: DataTypes.ENUM('payment_pending', 'pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled'),
    defaultValue: 'pending',
  },
  question: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  // Список проблем клиента в одной записи (мультизапрос). question = первая проблема
  // (краткое резюме) для совместимости со списками/уведомлениями/напоминаниями.
  problems: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  // Категория права (специализация) всей записи — id из справочника специализаций
  // (civil/family/…). Помогает юристу/фильтрам понять область. Необязательное.
  specialization: {
    type: DataTypes.STRING,
  },
  description: {
    type: DataTypes.TEXT,
  },
  preferredDate: {
    type: DataTypes.DATEONLY,
  },
  preferredTime: {
    type: DataTypes.STRING,
  },
  // Длительность в минутах (30/60/90) — влияет на цену
  duration: {
    type: DataTypes.INTEGER,
    defaultValue: 60,
  },
  // Фактическая длительность видеозвонка в секундах (по факту соединения)
  actualDuration: {
    type: DataTypes.INTEGER,
  },
  price: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  isFree: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  // Применённый промокод (чтобы вернуть usedCount при отмене брони)
  promoCode: {
    type: DataTypes.STRING,
  },
  // Источник бесплатной брони: 'loyalty' (первая бесплатно) | 'subscription'
  // (включена в тариф) | null. Нужен, чтобы считать месячный лимит подписки
  // отдельно от акции лояльности.
  freeSource: {
    type: DataTypes.STRING,
  },
  notes: {
    type: DataTypes.TEXT,
  },
  // Приватная заметка ЮРИСТА по делу (подготовка, что спросить, фоллоу-ап).
  // Видна только юристу; клиенту НЕ показывается.
  lawyerNote: {
    type: DataTypes.TEXT,
  },
  // Напоминание за 1 час отправлено (чтобы не слать повторно)
  reminderSent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  // ─── Биллинг «оплата через 5 минут звонка» (модель B: холд → захват) ───
  // Момент, когда ОБА участника оказались в видеозвонке (детект по socket-комнате).
  // От него отсчитываются 5 минут до захвата оплаты. null — оба ещё не встретились.
  callStartedAt: {
    type: DataTypes.DATE,
  },
  // Момент захвата оплаты (списания с карты клиента) — на 5-й минуте разговора.
  chargedAt: {
    type: DataTypes.DATE,
  },
  // Статус биллинга:
  //  none     — бесплатная/не требует оплаты
  //  held     — карта авторизована при брони (деньги заморожены, не списаны)
  //  charged  — захвачено на 5-й минуте (деньги в эскроу/pendingBalance)
  //  released — эскроу отдан юристу при завершении
  //  failed   — захват не прошёл (нет холда/денег) — решает юрист/админ
  billingStatus: {
    type: DataTypes.ENUM('none', 'held', 'charged', 'released', 'failed'),
    defaultValue: 'none',
  },
  legalAcceptedAt: { type: DataTypes.DATE },
  legalVersion: { type: DataTypes.STRING },
  scheduledStartAt: { type: DataTypes.DATE },
  scheduledEndAt: { type: DataTypes.DATE },
  scheduleTimezone: { type: DataTypes.STRING(64) },
  meetingProvider: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'webrtc' },
  // Оценка консультации живёт ТОЛЬКО в таблице Review
  // (Consultation.hasOne(Review, as: 'consultationReview')). Мёртвые столбцы
  // rating/review удалены миграцией 20260724000000-remove-dead-consultation-columns.
  //
  // Частичный УНИКАЛЬНЫЙ индекс consultations_loyalty_free_unique (одна не-отклонённая
  // loyalty-бесплатная бронь на клиента) создаётся МИГРАЦИЕЙ 20260807000000 (dev/prod)
  // и вручную в tests/helpers.resetDb (тестовая БД через sync). В модели не объявлен:
  // Sequelize не underscore-мапит колонки в предикате частичного индекса при sync.
});

// ─── AI CONVERSATION MODEL ──────────────────────────────────
const AIConversation = sequelize.define('AIConversation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING,
    defaultValue: 'Новый разговор',
  },
  category: {
    type: DataTypes.STRING,
  },
});

// ─── LEGAL KNOWLEDGE BASE ───────────────────────────────────
// Полные тексты загружаются только из разрешённого/лицензированного корпуса.
// sourceUrl всегда ведёт на официальный оригинал, а версии не перезаписываются.
const LegalDocument = sequelize.define('LegalDocument', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING },
  language: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'ru' },
  sourceUrl: { type: DataTypes.TEXT, allowNull: false },
  version: { type: DataTypes.STRING, allowNull: false },
  effectiveFrom: { type: DataTypes.DATEONLY },
  effectiveTo: { type: DataTypes.DATEONLY },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  checksum: { type: DataTypes.STRING(64) },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  indexes: [{ name: 'legal_documents_source_version_unique', unique: true, fields: ['source_url', 'version'] }],
});

const LegalChunk = sequelize.define('LegalChunk', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  ordinal: { type: DataTypes.INTEGER, allowNull: false },
  articleNumber: { type: DataTypes.STRING },
  heading: { type: DataTypes.TEXT },
  content: { type: DataTypes.TEXT, allowNull: false },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  indexes: [{ name: 'legal_chunks_document_ordinal_unique', unique: true, fields: ['document_id', 'ordinal'] }],
});

// ─── AI MESSAGE MODEL ───────────────────────────────────────
const AIMessage = sequelize.define('AIMessage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  text: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  isUser: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  category: {
    type: DataTypes.STRING,
  },
  sources: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },
  fallback: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
});

// ─── DOCUMENT MODEL ─────────────────────────────────────────
const Document = sequelize.define('Document', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING,
  },
  size: {
    type: DataTypes.INTEGER,
  },
  path: {
    type: DataTypes.STRING,
  },
  status: {
    type: DataTypes.ENUM('pending', 'verified', 'issues', 'rejected'),
    defaultValue: 'pending',
  },
  aiAnalysis: {
    type: DataTypes.JSONB,
  },
  // Категория/папка документа (Договор, Доверенность, Заявление, Иск, Другое)
  category: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

// ─── LAWYER VERIFICATION DOCUMENT ───────────────────────────
// Верификационные документы юриста (диплом, лицензия/ордер, удостоверение).
// Видны ТОЛЬКО самому юристу и админу (не публично, не клиентам).
const LawyerDocument = sequelize.define('LawyerDocument', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  // Тип документа для проверки админом.
  type: {
    type: DataTypes.ENUM('diploma', 'license', 'certificate', 'id', 'other'),
    defaultValue: 'other',
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  path: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  mimeType: {
    type: DataTypes.STRING,
  },
  size: {
    type: DataTypes.INTEGER,
  },
});

const LawyerExperience = sequelize.define('LawyerExperience', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  organization: { type: DataTypes.STRING(255), allowNull: false },
  position: { type: DataTypes.STRING(255), allowNull: false },
  startDate: { type: DataTypes.DATEONLY, allowNull: false },
  endDate: { type: DataTypes.DATEONLY },
  isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  description: { type: DataTypes.TEXT },
  displayOrder: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
}, { indexes: [{ name: 'lawyer_experiences_user_order_idx', fields: ['user_id', 'display_order'] }] });

const LawyerEducation = sequelize.define('LawyerEducation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  university: { type: DataTypes.STRING(255), allowNull: false },
  faculty: { type: DataTypes.STRING(255) },
  specialty: { type: DataTypes.STRING(255), allowNull: false },
  degree: { type: DataTypes.STRING(120) },
  startYear: { type: DataTypes.INTEGER },
  endYear: { type: DataTypes.INTEGER },
  country: { type: DataTypes.STRING(120) },
  city: { type: DataTypes.STRING(120) },
  displayOrder: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
}, { indexes: [{ name: 'lawyer_educations_user_order_idx', fields: ['user_id', 'display_order'] }] });

const LawyerCertificate = sequelize.define('LawyerCertificate', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  documentId: { type: DataTypes.UUID },
  title: { type: DataTypes.STRING(255), allowNull: false },
  organization: { type: DataTypes.STRING(255) },
  issuedAt: { type: DataTypes.DATEONLY },
  credentialUrl: { type: DataTypes.TEXT },
  displayOrder: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
}, { indexes: [{ name: 'lawyer_certificates_user_order_idx', fields: ['user_id', 'display_order'] }] });

const LawyerOAuthAccount = sequelize.define('LawyerOAuthAccount', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  provider: { type: DataTypes.STRING(32), allowNull: false },
  providerAccountId: { type: DataTypes.STRING(255), allowNull: false },
  providerEmail: { type: DataTypes.STRING(255) },
  lastLoginAt: { type: DataTypes.DATE },
}, {
  tableName: 'lawyer_oauth_accounts',
  indexes: [
    { name: 'lawyer_oauth_provider_subject_unique', unique: true, fields: ['provider', 'provider_account_id'] },
    { name: 'lawyer_oauth_user_provider_unique', unique: true, fields: ['user_id', 'provider'] },
  ],
});

const ZoomConnection = sequelize.define('ZoomConnection', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  zoomUserId: { type: DataTypes.STRING(255), allowNull: false },
  zoomAccountId: { type: DataTypes.STRING(255) },
  zoomEmail: { type: DataTypes.STRING(255) },
  accessTokenEncrypted: { type: DataTypes.TEXT, allowNull: false },
  refreshTokenEncrypted: { type: DataTypes.TEXT, allowNull: false },
  tokenExpiresAt: { type: DataTypes.DATE, allowNull: false },
  scopes: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false, defaultValue: [] },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'connected' },
  lastError: { type: DataTypes.TEXT },
  connectedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  disconnectedAt: { type: DataTypes.DATE },
}, { indexes: [
  { name: 'zoom_connections_user_unique', unique: true, fields: ['user_id'] },
  { name: 'zoom_connections_zoom_user_connected_unique', unique: true, fields: ['zoom_user_id'], where: { status: 'connected' } },
] });

const ConsultationMeeting = sequelize.define('ConsultationMeeting', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  consultationId: { type: DataTypes.UUID, allowNull: false },
  zoomConnectionId: { type: DataTypes.UUID },
  provider: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'zoom' },
  externalMeetingId: { type: DataTypes.STRING(255) },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'creating' },
  joinUrlEncrypted: { type: DataTypes.TEXT },
  startUrlEncrypted: { type: DataTypes.TEXT },
  passcodeEncrypted: { type: DataTypes.TEXT },
  scheduledAt: { type: DataTypes.DATE },
  duration: { type: DataTypes.INTEGER },
  lastError: { type: DataTypes.TEXT },
  startedAt: { type: DataTypes.DATE },
  endedAt: { type: DataTypes.DATE },
  cancelledAt: { type: DataTypes.DATE },
}, {
  indexes: [
    { name: 'consultation_meetings_consultation_unique', unique: true, fields: ['consultation_id'] },
    { name: 'consultation_meetings_provider_external_unique', unique: true, fields: ['provider', 'external_meeting_id'] },
  ],
});

const ZoomWebhookEvent = sequelize.define('ZoomWebhookEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  requestId: { type: DataTypes.STRING(255), allowNull: false },
  event: { type: DataTypes.STRING(120), allowNull: false },
  payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'processed' },
  processedAt: { type: DataTypes.DATE },
}, { indexes: [{ name: 'zoom_webhook_events_request_unique', unique: true, fields: ['request_id'] }] });

const LawyerProfileStatusHistory = sequelize.define('LawyerProfileStatusHistory', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  lawyerProfileId: { type: DataTypes.UUID, allowNull: false },
  actorUserId: { type: DataTypes.UUID },
  fromStatus: { type: DataTypes.STRING(32) },
  toStatus: { type: DataTypes.STRING(32), allowNull: false },
  reason: { type: DataTypes.TEXT },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  updatedAt: false,
  indexes: [{ name: 'lawyer_profile_status_history_profile_created_idx', fields: ['lawyer_profile_id', 'created_at'] }],
});

// ─── CASE DOCUMENT (рабочие документы по консультации) ──────
// Файлы по конкретному делу (договор, черновик иска, справки). Видны ОБОИМ
// участникам консультации — клиенту и юристу. uploaderId — кто загрузил.
const CaseDocument = sequelize.define('CaseDocument', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  path: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  mimeType: {
    type: DataTypes.STRING,
  },
  size: {
    type: DataTypes.INTEGER,
  },
});

// ─── REVIEW MODEL ───────────────────────────────────────────
const Review = sequelize.define('Review', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 5 },
  },
  text: {
    type: DataTypes.TEXT,
  },
  // Скрыт админом (модерация) — не показывается публично и не влияет на рейтинг
  isHidden: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  replyText: {
    type: DataTypes.TEXT,
  },
  repliedAt: {
    type: DataTypes.DATE,
  },
  helpfulCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
});

// ─── NOTIFICATION MODEL ────────────────────────────────────
const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
});

// ─── SPECIALIZATION MODEL ───────────────────────────────────
const Specialization = sequelize.define('Specialization', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  nameUz: {
    type: DataTypes.STRING,
  },
  nameEn: {
    type: DataTypes.STRING,
  },
  icon: {
    type: DataTypes.STRING,
    defaultValue: 'Gavel',
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  lawyerCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  indexes: [{ name: 'specializations_name_key', unique: true, fields: ['name'] }],
});

// ─── MESSAGE MODEL (Chat between lawyer and client) ────────
const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  text: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

// ─── FAVORITE LAWYER MODEL ──────────────────────────────────
const FavoriteLawyer = sequelize.define('FavoriteLawyer', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
}, {
  indexes: [
    {
      unique: true,
      fields: ['client_id', 'lawyer_id'],
    },
  ],
});

// ─── SUBSCRIPTION MODEL ─────────────────────────────────────
const Subscription = sequelize.define('Subscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  plan: {
    type: DataTypes.ENUM('free', 'basic', 'pro'),
    defaultValue: 'free',
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true, // null = бессрочно (для free)
  },
  price: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
});

// ─── PAYMENT MODEL ──────────────────────────────────────────
const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  currency: {
    type: DataTypes.STRING,
    defaultValue: 'UZS',
  },
  provider: {
    type: DataTypes.ENUM('payme', 'click', 'uzcard'),
    defaultValue: 'payme',
  },
  status: {
    type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded'),
    defaultValue: 'pending',
  },
  transactionId: {
    type: DataTypes.STRING,
  },
  providerResponse: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  // Эскроу по этому платежу уже высвобождено юристу (pendingBalance → balance).
  // Признак привязан к ПЛАТЕЖУ, а не к изменяемому статусу консультации: повторное
  // завершение (в т.ч. после отката статуса) НЕ выплачивает второй раз.
  escrowReleased: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  refundStatus: {
    type: DataTypes.ENUM('none', 'requested', 'completed', 'failed'),
    allowNull: false,
    defaultValue: 'none',
  },
  refundRequestedAt: { type: DataTypes.DATE },
  refundedAt: { type: DataTypes.DATE },
  refundReason: { type: DataTypes.TEXT },
  refundRequestedBy: { type: DataTypes.UUID },
});

// ─── PHONE OTP MODEL ────────────────────────────────────────
// Одноразовые коды подтверждения для входа/регистрации по номеру телефона.
// Один активный код на номер (phone уникален) — перезаписывается при повторном запросе.
const PhoneOtp = sequelize.define('PhoneOtp', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  indexes: [{ name: 'phone_otps_phone_key', unique: true, fields: ['phone'] }],
});

// ─── SUPPORT TICKET MODEL ───────────────────────────────────
const SupportTicket = sequelize.define('SupportTicket', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  subject: {
    type: DataTypes.STRING,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('open', 'in_progress', 'closed'),
    defaultValue: 'open',
  },
  // Ответ администратора автору обращения (+ когда ответили)
  response: {
    type: DataTypes.TEXT,
  },
  respondedAt: {
    type: DataTypes.DATE,
  },
});

// ─── PROMO CODE MODEL ───────────────────────────────────────
const Promo = sequelize.define('Promo', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  discountPercent: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 100 },
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  expiresAt: {
    type: DataTypes.DATE, // null = бессрочный
  },
  usageLimit: {
    type: DataTypes.INTEGER, // null = без лимита
  },
  usedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  minAmount: {
    type: DataTypes.INTEGER, // минимальная сумма для применения
    defaultValue: 0,
  },
}, {
  indexes: [{ name: 'promos_code_key', unique: true, fields: ['code'] }],
});

// ─── WITHDRAWAL MODEL (леджер выводов юриста) ───────────────
const Withdrawal = sequelize.define('Withdrawal', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  status: {
    // pending — заявка принята; paid — реально переведено (Payme Transfer, Фаза 6);
    // failed/cancelled — служебные
    type: DataTypes.ENUM('pending', 'processing', 'paid', 'failed', 'cancelled'),
    defaultValue: 'pending',
  },
  provider: {
    type: DataTypes.STRING,
    defaultValue: 'manual',
  },
  note: {
    type: DataTypes.TEXT,
  },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'UZS' },
  idempotencyKey: { type: DataTypes.STRING },
  providerTransactionId: { type: DataTypes.STRING },
  providerReference: { type: DataTypes.STRING },
  destinationSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  processingAt: { type: DataTypes.DATE },
  processedAt: { type: DataTypes.DATE },
  processedBy: { type: DataTypes.UUID },
  failureCode: { type: DataTypes.STRING },
  failureMessage: { type: DataTypes.TEXT },
});

const FinancialEvent = sequelize.define('FinancialEvent', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  consultationId: { type: DataTypes.UUID },
  paymentId: { type: DataTypes.UUID },
  withdrawalId: { type: DataTypes.UUID },
  actorUserId: { type: DataTypes.UUID },
  source: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(12, 2) },
  idempotencyKey: { type: DataTypes.STRING, allowNull: false },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  updatedAt: false,
  indexes: [{ name: 'financial_events_idempotency_unique', unique: true, fields: ['idempotency_key'] }],
});

// Web-push подписка устройства (один пользователь → много устройств)
const PushSubscription = sequelize.define('PushSubscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  endpoint: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  // { p256dh, auth } — ключи шифрования из PushSubscription.toJSON().keys
  keys: {
    type: DataTypes.JSONB,
    allowNull: false,
  },
}, {
  indexes: [{ name: 'push_subscriptions_endpoint_key', unique: true, fields: ['endpoint'] }],
});

// ─── ASSOCIATIONS ───────────────────────────────────────────

// User <-> LawyerProfile (1:1 for lawyers)
User.hasOne(LawyerProfile, { foreignKey: 'userId', as: 'profile' });
LawyerProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(LawyerExperience, { foreignKey: 'userId', as: 'lawyerExperiences', onDelete: 'CASCADE' });
LawyerExperience.belongsTo(User, { foreignKey: 'userId', as: 'lawyer' });
User.hasMany(LawyerEducation, { foreignKey: 'userId', as: 'lawyerEducations', onDelete: 'CASCADE' });
LawyerEducation.belongsTo(User, { foreignKey: 'userId', as: 'lawyer' });
User.hasMany(LawyerCertificate, { foreignKey: 'userId', as: 'lawyerCertificates', onDelete: 'CASCADE' });
LawyerCertificate.belongsTo(User, { foreignKey: 'userId', as: 'lawyer' });
User.hasMany(LawyerOAuthAccount, { foreignKey: 'userId', as: 'lawyerOAuthAccounts', onDelete: 'CASCADE' });
LawyerOAuthAccount.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasOne(ZoomConnection, { foreignKey: 'userId', as: 'zoomConnection', onDelete: 'CASCADE' });
ZoomConnection.belongsTo(User, { foreignKey: 'userId', as: 'lawyer' });
LawyerProfile.hasMany(LawyerProfileStatusHistory, { foreignKey: 'lawyerProfileId', as: 'statusHistory', onDelete: 'CASCADE' });
LawyerProfileStatusHistory.belongsTo(LawyerProfile, { foreignKey: 'lawyerProfileId', as: 'profile' });
LawyerProfileStatusHistory.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor' });

// Client <-> Consultation
User.hasMany(Consultation, { foreignKey: 'clientId', as: 'clientConsultations' });
Consultation.belongsTo(User, { foreignKey: 'clientId', as: 'client' });

// Lawyer <-> Consultation
User.hasMany(Consultation, { foreignKey: 'lawyerId', as: 'lawyerConsultations' });
Consultation.belongsTo(User, { foreignKey: 'lawyerId', as: 'lawyer' });
Consultation.hasOne(ConsultationMeeting, { foreignKey: 'consultationId', as: 'meeting', onDelete: 'CASCADE' });
ConsultationMeeting.belongsTo(Consultation, { foreignKey: 'consultationId', as: 'consultation' });
ZoomConnection.hasMany(ConsultationMeeting, { foreignKey: 'zoomConnectionId', as: 'meetings' });
ConsultationMeeting.belongsTo(ZoomConnection, { foreignKey: 'zoomConnectionId', as: 'zoomConnection' });

// User <-> AIConversation
User.hasMany(AIConversation, { foreignKey: 'userId', as: 'conversations' });
AIConversation.belongsTo(User, { foreignKey: 'userId' });

// AIConversation <-> AIMessage
AIConversation.hasMany(AIMessage, { foreignKey: 'conversationId', as: 'messages' });
AIMessage.belongsTo(AIConversation, { foreignKey: 'conversationId' });

LegalDocument.hasMany(LegalChunk, { foreignKey: 'documentId', as: 'chunks', onDelete: 'CASCADE' });
LegalChunk.belongsTo(LegalDocument, { foreignKey: 'documentId', as: 'document' });

// User <-> Document
User.hasMany(Document, { foreignKey: 'userId', as: 'documents' });
Document.belongsTo(User, { foreignKey: 'userId' });

// Lawyer (User) <-> LawyerDocument (верификационные документы)
User.hasMany(LawyerDocument, { foreignKey: 'userId', as: 'lawyerDocuments' });
LawyerDocument.belongsTo(User, { foreignKey: 'userId' });
LawyerCertificate.belongsTo(LawyerDocument, { foreignKey: 'documentId', as: 'document' });
LawyerDocument.hasOne(LawyerCertificate, { foreignKey: 'documentId', as: 'certificate' });

// Consultation <-> CaseDocument (рабочие документы по делу); uploader — автор загрузки
Consultation.hasMany(CaseDocument, { foreignKey: 'consultationId', as: 'caseDocuments' });
CaseDocument.belongsTo(Consultation, { foreignKey: 'consultationId' });
User.hasMany(CaseDocument, { foreignKey: 'uploaderId', as: 'uploadedCaseDocuments' });
CaseDocument.belongsTo(User, { foreignKey: 'uploaderId', as: 'uploader' });

// Client <-> Review (author)
User.hasMany(Review, { foreignKey: 'clientId', as: 'writtenReviews' });
Review.belongsTo(User, { foreignKey: 'clientId', as: 'client' });

// Lawyer <-> Review (target)
User.hasMany(Review, { foreignKey: 'lawyerId', as: 'receivedReviews' });
Review.belongsTo(User, { foreignKey: 'lawyerId', as: 'lawyer' });

// Consultation <-> Review
Consultation.hasOne(Review, { foreignKey: 'consultationId', as: 'consultationReview' });
Review.belongsTo(Consultation, { foreignKey: 'consultationId' });

// User <-> Notification
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'userId' });

// User <-> PushSubscription (web-push устройства)
User.hasMany(PushSubscription, { foreignKey: 'userId', as: 'pushSubscriptions' });
PushSubscription.belongsTo(User, { foreignKey: 'userId' });

// Consultation <-> Message (chat)
Consultation.hasMany(Message, { foreignKey: 'consultationId', as: 'messages' });
Message.belongsTo(Consultation, { foreignKey: 'consultationId' });

// User (sender) <-> Message
User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });

// Client <-> FavoriteLawyer
User.hasMany(FavoriteLawyer, { foreignKey: 'clientId', as: 'favorites' });
FavoriteLawyer.belongsTo(User, { foreignKey: 'clientId', as: 'client' });

// Lawyer <-> FavoriteLawyer
User.hasMany(FavoriteLawyer, { foreignKey: 'lawyerId', as: 'favoritedBy' });
FavoriteLawyer.belongsTo(User, { foreignKey: 'lawyerId', as: 'lawyer' });

// Payment <-> Consultation
Consultation.hasMany(Payment, { foreignKey: 'consultationId', as: 'payments' });
Payment.belongsTo(Consultation, { foreignKey: 'consultationId' });

// Payment <-> User (payer)
User.hasMany(Payment, { foreignKey: 'userId', as: 'payments' });
Payment.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(Withdrawal, { foreignKey: 'lawyerId', as: 'withdrawals' });
Withdrawal.belongsTo(User, { foreignKey: 'lawyerId', as: 'lawyer' });

// User <-> Subscription (1:1 — у каждого пользователя одна активная подписка)
User.hasOne(Subscription, { foreignKey: 'userId', as: 'subscription' });
Subscription.belongsTo(User, { foreignKey: 'userId' });

// User <-> SupportTicket
User.hasMany(SupportTicket, { foreignKey: 'userId', as: 'supportTickets' });
SupportTicket.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = {
  sequelize,
  User,
  LawyerProfile,
  LawyerExperience,
  LawyerEducation,
  LawyerCertificate,
  LawyerOAuthAccount,
  ZoomConnection,
  ConsultationMeeting,
  ZoomWebhookEvent,
  LawyerProfileStatusHistory,
  Consultation,
  AIConversation,
  AIMessage,
  LegalDocument,
  LegalChunk,
  Document,
  LawyerDocument,
  CaseDocument,
  Review,
  Notification,
  Specialization,
  Message,
  FavoriteLawyer,
  Payment,
  Subscription,
  SupportTicket,
  Promo,
  Withdrawal,
  FinancialEvent,
  PushSubscription,
  PhoneOtp,
};

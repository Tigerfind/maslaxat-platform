const sequelize = require('../config/database');
const { DataTypes, Op } = require('sequelize');
const bcrypt = require('bcryptjs');

function validateStorageMetadata(instance, fields) {
  const provider = instance.get(fields.provider);
  const key = instance.get(fields.key);
  if (!key && !provider) return;
  const mimeType = instance.get(fields.mime);
  const size = instance.get(fields.size);
  const sha256 = instance.get(fields.sha);
  if (!key || !['local', 'r2'].includes(provider)
    || typeof mimeType !== 'string' || !mimeType.trim()
    || !Number.isInteger(size) || size < 0
    || !/^[0-9a-f]{64}$/.test(sha256 || '')) {
    throw new Error('Complete valid storage metadata is required when storageKey is present');
  }
}

// ─── USER MODEL ─────────────────────────────────────────────
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  email: {
    type: DataTypes.STRING,
    unique: true,
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
  accountType: {
    type: DataTypes.ENUM('member', 'admin'),
    allowNull: false,
    defaultValue: 'member',
  },
  preferredMode: {
    type: DataTypes.ENUM('client', 'lawyer'),
  },
  avatar: {
    type: DataTypes.STRING,
  },
  avatarStorageProvider: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { isIn: [['local', 'r2']] },
  },
  avatarStorageKey: {
    type: DataTypes.STRING(1024),
    allowNull: true,
  },
  avatarMimeType: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  avatarSize: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 0 },
  },
  avatarSha256: {
    type: DataTypes.CHAR(64),
    allowNull: true,
    validate: { is: /^[0-9a-f]{64}$/ },
  },
  avatarLocalPath: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
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
  twoFactorVersion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  twoFactorBackupCodes: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
}, {
  indexes: [{
    name: 'users_avatar_storage_key_unique',
    unique: true,
    fields: ['avatar_storage_provider', 'avatar_storage_key'],
    where: { avatar_storage_key: { [Op.ne]: null } },
  }],
  validate: {
    avatarStorageMetadataComplete() {
      validateStorageMetadata(this, {
        provider: 'avatarStorageProvider', key: 'avatarStorageKey', mime: 'avatarMimeType',
        size: 'avatarSize', sha: 'avatarSha256',
      });
      if (this.avatarLocalPath && !this.avatarStorageKey) {
        throw new Error('Avatar local path requires managed storage metadata');
      }
    },
  },
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
  delete values.avatarStorageProvider;
  delete values.avatarStorageKey;
  delete values.avatarMimeType;
  delete values.avatarSize;
  delete values.avatarSha256;
  delete values.avatarLocalPath;
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
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: 'lawyer_profiles_user_id_unique',
  },
  revision: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: { min: 1 },
  },
  // Основная специализация (для обратной совместимости: = specializations[0]).
  // Каталог/карточка исторически читают это поле; держим синхронно с массивом.
  specialization: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // Все специализации юриста (мультивыбор). Источник истины; specialization = первая.
  specializations: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: [],
  },
  description: {
    type: DataTypes.TEXT,
  },
  headline: {
    type: DataTypes.STRING,
  },
  workExperience: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },
  profileSources: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
  verifiedSnapshot: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
  verifiedAt: {
    type: DataTypes.DATE,
  },
  linkedinUrl: {
    type: DataTypes.STRING,
    set(value) {
      if (value === null || value === undefined || String(value).trim() === '') {
        this.setDataValue('linkedinUrl', null);
        return;
      }
      let parsed;
      try {
        parsed = new URL(String(value).trim());
      } catch (_error) {
        throw new Error('LinkedIn URL is invalid');
      }
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== 'https:'
        || !['linkedin.com', 'www.linkedin.com'].includes(host)
        || parsed.username
        || parsed.password
        || parsed.port
        || !/^\/in\/[^/]+\/?$/.test(parsed.pathname)) {
        throw new Error('LinkedIn URL must be an HTTPS linkedin.com member profile');
      }
      parsed.hostname = host;
      parsed.search = '';
      parsed.hash = '';
      this.setDataValue('linkedinUrl', parsed.toString());
    },
  },
  // Автоприветствие: авто-сообщение юриста при открытии чата (если сообщений ещё нет)
  greeting: {
    type: DataTypes.TEXT,
  },
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
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
  },
  operatingStatus: {
    type: DataTypes.ENUM('enabled', 'suspended'),
    allowNull: false,
    defaultValue: 'suspended',
  },
  // Причина отклонения — показывается юристу, чтобы он исправил и подал снова.
  rejectionReason: {
    type: DataTypes.TEXT,
  },
  promotionPilotEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
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
  commissionRateBps: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  grossAmountTiyin: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  lawyerNetAmountTiyin: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
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
    allowNull: true,
  },
  storageProvider: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { isIn: [['local', 'r2']] },
  },
  storageKey: {
    type: DataTypes.STRING(1024),
    allowNull: true,
  },
  mimeType: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  sha256: {
    type: DataTypes.CHAR(64),
    allowNull: true,
    validate: { is: /^[0-9a-f]{64}$/ },
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
}, {
  indexes: [{
    name: 'documents_storage_key_unique',
    unique: true,
    fields: ['storage_provider', 'storage_key'],
    where: { storage_key: { [Op.ne]: null } },
  }],
  validate: {
    storageMetadataComplete() {
      validateStorageMetadata(this, {
        provider: 'storageProvider', key: 'storageKey', mime: 'mimeType', size: 'size', sha: 'sha256',
      });
    },
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
    type: DataTypes.ENUM('diploma', 'license', 'id', 'other'),
    defaultValue: 'other',
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  path: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  storageProvider: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { isIn: [['local', 'r2']] },
  },
  storageKey: {
    type: DataTypes.STRING(1024),
    allowNull: true,
  },
  sha256: {
    type: DataTypes.CHAR(64),
    allowNull: true,
    validate: { is: /^[0-9a-f]{64}$/ },
  },
  mimeType: {
    type: DataTypes.STRING,
  },
  size: {
    type: DataTypes.INTEGER,
  },
  verificationStatus: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pending',
    validate: { isIn: [['pending', 'approved', 'rejected']] },
  },
  approvedByUserId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  indexes: [{
    name: 'lawyer_documents_storage_key_unique',
    unique: true,
    fields: ['storage_provider', 'storage_key'],
    where: { storage_key: { [Op.ne]: null } },
  }],
  validate: {
    storageMetadataComplete() {
      validateStorageMetadata(this, {
        provider: 'storageProvider', key: 'storageKey', mime: 'mimeType', size: 'size', sha: 'sha256',
      });
    },
  },
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
    allowNull: true,
  },
  storageProvider: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { isIn: [['local', 'r2']] },
  },
  storageKey: {
    type: DataTypes.STRING(1024),
    allowNull: true,
  },
  sha256: {
    type: DataTypes.CHAR(64),
    allowNull: true,
    validate: { is: /^[0-9a-f]{64}$/ },
  },
  mimeType: {
    type: DataTypes.STRING,
  },
  size: {
    type: DataTypes.INTEGER,
  },
}, {
  indexes: [{
    name: 'case_documents_storage_key_unique',
    unique: true,
    fields: ['storage_provider', 'storage_key'],
    where: { storage_key: { [Op.ne]: null } },
  }],
  validate: {
    storageMetadataComplete() {
      validateStorageMetadata(this, {
        provider: 'storageProvider', key: 'storageKey', mime: 'mimeType', size: 'size', sha: 'sha256',
      });
    },
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
  dedupeKey: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  indexes: [{
    name: 'notifications_dedupe_key_unique',
    unique: true,
    fields: ['dedupe_key'],
    where: { dedupe_key: { [Op.ne]: null } },
  }],
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
    unique: true,
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

const PromotionPackage = sequelize.define('PromotionPackage', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  name: { type: DataTypes.JSONB, allowNull: false },
  placement: { type: DataTypes.STRING, allowNull: false, defaultValue: 'catalog_top' },
  durationDays: { type: DataTypes.INTEGER, allowNull: false },
  priceAmountTiyin: { type: DataTypes.BIGINT, allowNull: false },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'UZS' },
  maxActiveSlots: { type: DataTypes.INTEGER, allowNull: false },
  sponsoredPositions: { type: DataTypes.ARRAY(DataTypes.INTEGER), allowNull: false, defaultValue: [0, 3] },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  displayOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  validate: {
    validPromotionPackage() {
      const price = Number(this.priceAmountTiyin);
      const positions = this.sponsoredPositions;
      if (this.placement !== 'catalog_top') throw new Error('Unsupported promotion placement');
      if (![7, 30].includes(Number(this.durationDays))) throw new Error('Promotion duration must be 7 or 30 days');
      if (!Number.isSafeInteger(price) || price <= 0) throw new Error('Promotion price must be positive integer tiyin');
      if (!Number.isInteger(this.maxActiveSlots) || this.maxActiveSlots <= 0) throw new Error('Promotion capacity must be positive');
      if (!Array.isArray(positions) || positions.length < 1 || positions.length > 2
        || new Set(positions).size !== positions.length
        || positions.some((position) => !Number.isInteger(position) || position < 0 || position > 19)) {
        throw new Error('Sponsored positions must contain one or two unique first-page positions');
      }
    },
  },
});

const LawyerPromotion = sequelize.define('LawyerPromotion', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  lawyerId: { type: DataTypes.UUID, allowNull: false },
  packageId: { type: DataTypes.UUID, allowNull: false },
  paymentId: { type: DataTypes.UUID, allowNull: true, unique: true },
  idempotencyKey: { type: DataTypes.STRING, allowNull: false },
  placement: { type: DataTypes.STRING, allowNull: false },
  specialization: { type: DataTypes.STRING, allowNull: false },
  location: { type: DataTypes.STRING, allowNull: true },
  durationDays: { type: DataTypes.INTEGER, allowNull: false },
  priceAmountTiyin: { type: DataTypes.BIGINT, allowNull: false },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  maxActiveSlots: { type: DataTypes.INTEGER, allowNull: false },
  sponsoredPositions: { type: DataTypes.ARRAY(DataTypes.INTEGER), allowNull: false },
  status: {
    type: DataTypes.ENUM('pending_payment', 'queued', 'scheduled', 'active', 'paused', 'expired', 'cancelled', 'refund_pending', 'refunded'),
    allowNull: false,
    defaultValue: 'pending_payment',
  },
  reservationExpiresAt: { type: DataTypes.DATE, allowNull: true },
  paidAt: { type: DataTypes.DATE, allowNull: true },
  startsAt: { type: DataTypes.DATE, allowNull: true },
  activeSince: { type: DataTypes.DATE, allowNull: true },
  endsAt: { type: DataTypes.DATE, allowNull: true },
  pausedAt: { type: DataTypes.DATE, allowNull: true },
  resumeDeadline: { type: DataTypes.DATE, allowNull: true },
  remainingSeconds: { type: DataTypes.INTEGER, allowNull: true },
  cancellationRequestedAt: { type: DataTypes.DATE, allowNull: true },
  cancelledAt: { type: DataTypes.DATE, allowNull: true },
  cancellationReason: { type: DataTypes.STRING, allowNull: true },
  refundRequestedAt: { type: DataTypes.DATE, allowNull: true },
  refundedAt: { type: DataTypes.DATE, allowNull: true },
  impressions: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  profileViews: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  bookingStarts: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  bookings: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
}, {
  indexes: [
    { name: 'lawyer_promotions_owner_idempotency_unique', unique: true, fields: ['lawyer_id', 'idempotency_key'] },
    { name: 'lawyer_promotions_scope_status_idx', fields: ['placement', 'specialization', 'location', 'status'] },
    { name: 'lawyer_promotions_fifo_idx', fields: ['placement', 'specialization', 'location', 'status', 'paid_at', 'id'] },
  ],
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
  purpose: {
    type: DataTypes.ENUM('consultation', 'consultation_extension', 'subscription', 'lawyer_promotion'),
    allowNull: true,
  },
  amountTiyin: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  refundedAmountTiyin: {
    type: DataTypes.BIGINT,
    allowNull: true,
    defaultValue: 0,
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
    type: DataTypes.ENUM('pending', 'processing', 'paid', 'cancelled', 'failed', 'refund_pending', 'partially_refunded', 'refunded'),
    defaultValue: 'pending',
  },
  transactionId: {
    type: DataTypes.STRING,
  },
  providerTransactionId: {
    type: DataTypes.STRING,
  },
  idempotencyKey: {
    type: DataTypes.STRING(320),
  },
  providerResponse: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  providerData: {
    type: DataTypes.JSONB,
  },
  paidAt: {
    type: DataTypes.DATE,
  },
  cancelledAt: {
    type: DataTypes.DATE,
  },
  refundedAt: {
    type: DataTypes.DATE,
  },
  lawyerPromotionId: {
    type: DataTypes.UUID,
  },
  // Эскроу по этому платежу уже высвобождено юристу (pendingBalance → balance).
  // Признак привязан к ПЛАТЕЖУ, а не к изменяемому статусу консультации: повторное
  // завершение (в т.ч. после отката статуса) НЕ выплачивает второй раз.
  escrowReleased: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  indexes: [
    {
      name: 'payments_provider_transaction_unique',
      unique: true,
      fields: ['provider', 'provider_transaction_id'],
      where: { provider_transaction_id: { [Op.ne]: null } },
    },
    {
      name: 'payments_user_idempotency_unique',
      unique: true,
      fields: ['user_id', 'idempotency_key'],
      where: { idempotency_key: { [Op.ne]: null } },
    },
    {
      name: 'payments_consultation_active_unique',
      unique: true,
      fields: ['consultation_id'],
      where: {
        consultation_id: { [Op.ne]: null },
        purpose: 'consultation',
        status: { [Op.in]: ['pending', 'processing', 'paid', 'refund_pending', 'partially_refunded'] },
      },
    },
    {
      name: 'payments_lawyer_promotion_unique',
      unique: true,
      fields: ['lawyer_promotion_id'],
      where: { lawyer_promotion_id: { [Op.ne]: null } },
    },
  ],
  validate: {
    validAmounts() {
      if (this.amountTiyin !== null && this.amountTiyin !== undefined) {
        const amount = Number(this.amountTiyin);
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new Error('amountTiyin must be a positive safe integer');
        }
        if (this.refundedAmountTiyin !== null && this.refundedAmountTiyin !== undefined) {
          const refunded = Number(this.refundedAmountTiyin);
          if (!Number.isSafeInteger(refunded) || refunded < 0 || refunded > amount) {
            throw new Error('refundedAmountTiyin must be between zero and amountTiyin');
          }
        }
      }
    },
    validTypedSubject() {
      if (!this.purpose) return;
      if (['consultation', 'consultation_extension'].includes(this.purpose)) {
        if (!this.consultationId || this.subscriptionId || this.lawyerPromotionId) {
          throw new Error(`${this.purpose} payment requires only consultationId`);
        }
      } else if (this.purpose === 'subscription') {
        if (!this.subscriptionId || this.consultationId || this.lawyerPromotionId) {
          throw new Error('subscription payment requires only subscriptionId');
        }
      } else if (this.purpose === 'lawyer_promotion') {
        if (!this.lawyerPromotionId || this.consultationId || this.subscriptionId) {
          throw new Error('lawyer_promotion payment requires only lawyerPromotionId');
        }
      }
    },
  },
});

const immutableFinancialRow = () => {
  throw new Error('Posted financial rows are immutable');
};

const allowOnlyLedgerFinalization = (row, options) => {
  if (options.ledgerFinalize && row.previous('isPosted') === false
    && row.isPosted === true && row.previous('postingToken') && row.postingToken === null) return;
  immutableFinancialRow();
};

const PlatformSetting = sequelize.define('PlatformSetting', {
  key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  value: { type: DataTypes.STRING, allowNull: false },
});

const PlatformSettingAudit = sequelize.define('PlatformSettingAudit', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  key: { type: DataTypes.STRING, allowNull: false },
  oldValue: { type: DataTypes.TEXT, allowNull: false },
  newValue: { type: DataTypes.TEXT, allowNull: false },
  changedByUserId: { type: DataTypes.UUID, allowNull: false },
});

const FinancialTransaction = sequelize.define('FinancialTransaction', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  operationKey: { type: DataTypes.STRING, allowNull: false, unique: true },
  paymentId: { type: DataTypes.UUID, allowNull: true },
  reason: { type: DataTypes.STRING, allowNull: false },
  currency: { type: DataTypes.STRING(3), allowNull: false },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  postedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  isPosted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  postingToken: { type: DataTypes.UUID, allowNull: true },
}, {
  hooks: {
    beforeUpdate: allowOnlyLedgerFinalization,
    beforeDestroy: immutableFinancialRow,
    beforeBulkUpdate: immutableFinancialRow,
    beforeBulkDestroy: immutableFinancialRow,
  },
});

const FinancialEntry = sequelize.define('FinancialEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  financialTransactionId: { type: DataTypes.UUID, allowNull: false },
  postingToken: { type: DataTypes.UUID, allowNull: true },
  account: { type: DataTypes.STRING, allowNull: false },
  direction: { type: DataTypes.ENUM('debit', 'credit'), allowNull: false },
  amountTiyin: {
    type: DataTypes.BIGINT,
    allowNull: false,
    validate: {
      isPositive(value) {
        if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
          throw new Error('amountTiyin must be a positive safe integer');
        }
      },
    },
  },
}, {
  hooks: {
    beforeUpdate: immutableFinancialRow,
    beforeDestroy: immutableFinancialRow,
    beforeBulkUpdate: immutableFinancialRow,
    beforeBulkDestroy: immutableFinancialRow,
  },
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
    unique: true,
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
});

// Persisted second-factor challenges make TOTP/recovery exchange one-time and
// let social assertions map back to the same challenge across process restarts.
const AuthChallenge = sequelize.define('AuthChallenge', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  nonceHash: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  sourceHash: {
    type: DataTypes.STRING(64),
  },
  factorVersion: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  passwordState: {
    type: DataTypes.STRING(32),
    allowNull: false,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  consumedAt: {
    type: DataTypes.DATE,
  },
}, {
  indexes: [
    { name: 'auth_challenges_nonce_unique', unique: true, fields: ['nonce_hash'] },
    { name: 'auth_challenges_source_unique', unique: true, fields: ['source_hash'] },
    { name: 'auth_challenges_user_expiry_idx', fields: ['user_id', 'expires_at'] },
    { name: 'auth_challenges_expires_at_idx', fields: ['expires_at'] },
    { name: 'auth_challenges_consumed_at_idx', fields: ['consumed_at'] },
  ],
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
    unique: true,
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
    type: DataTypes.ENUM('pending', 'paid', 'failed', 'cancelled'),
    defaultValue: 'pending',
  },
  provider: {
    type: DataTypes.STRING,
    defaultValue: 'manual',
  },
  note: {
    type: DataTypes.TEXT,
  },
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
    unique: true,
  },
  // { p256dh, auth } — ключи шифрования из PushSubscription.toJSON().keys
  keys: {
    type: DataTypes.JSONB,
    allowNull: false,
  },
});

const ObjectCleanupTask = sequelize.define('ObjectCleanupTask', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  storageKey: {
    type: DataTypes.STRING(1024),
    allowNull: false,
  },
  provider: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'r2',
    validate: { isIn: [['r2', 'local']] },
  },
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  lastError: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pending',
    validate: { isIn: [['reserved', 'pending', 'processing', 'completed', 'failed', 'manual_review']] },
  },
  nextAttemptAt: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: DataTypes.NOW,
  },
  leaseToken: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  leaseExpiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  requiresOwnershipProof: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  ownershipToken: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  ownershipMetadata: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  preventsKeyReuse: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'object_cleanup_tasks',
  indexes: [
    {
      name: 'object_cleanup_tasks_active_key_unique',
      unique: true,
      fields: ['provider', 'storage_key'],
      where: { status: { [Op.in]: ['reserved', 'pending', 'processing'] } },
    },
    {
      name: 'object_cleanup_tasks_due_idx',
      fields: ['status', 'next_attempt_at', 'lease_expires_at', 'created_at'],
    },
    {
      name: 'object_cleanup_tasks_tombstone_unique',
      unique: true,
      fields: ['provider', 'storage_key'],
      where: { prevents_key_reuse: true },
    },
  ],
  validate: {
    ownershipProofComplete() {
      if (this.requiresOwnershipProof && !this.ownershipToken) {
        throw new Error('Ownership token is required for protected cleanup');
      }
      if (!this.requiresOwnershipProof && (this.ownershipToken || this.ownershipMetadata)) {
        throw new Error('Unprotected cleanup cannot carry ownership metadata');
      }
    },
  },
});

const LawyerProfileImport = sequelize.define('LawyerProfileImport', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: { type: DataTypes.UUID, allowNull: false },
  source: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'linkedin_pdf',
    validate: { isIn: [['linkedin_pdf']] },
  },
  status: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'uploaded',
    validate: { isIn: [['uploaded', 'parsing', 'draft', 'confirmed', 'failed', 'discarded']] },
  },
  storageKey: { type: DataTypes.TEXT, allowNull: false },
  uploadIdempotencyKey: { type: DataTypes.STRING(128), allowNull: true },
  originalName: { type: DataTypes.TEXT, allowNull: false },
  mimeType: {
    type: DataTypes.STRING(128),
    allowNull: false,
    validate: { isIn: [['application/pdf']] },
  },
  size: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 10 * 1024 * 1024 },
  },
  sha256: {
    type: DataTypes.CHAR(64),
    allowNull: false,
    validate: { is: /^[0-9a-f]{64}$/ },
  },
  parsedData: { type: DataTypes.JSONB, allowNull: true },
  acceptedData: { type: DataTypes.JSONB, allowNull: true },
  warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  parserVersion: { type: DataTypes.STRING(64), allowNull: true },
  profileRevision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } },
  confirmedFromVersion: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1 } },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  confirmedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'lawyer_profile_imports',
  indexes: [
    { name: 'lawyer_profile_imports_owner_status', fields: ['user_id', 'status'] },
    {
      name: 'lawyer_profile_imports_owner_idempotency_unique',
      unique: true,
      fields: ['user_id', 'upload_idempotency_key'],
      where: { upload_idempotency_key: { [Op.ne]: null } },
    },
    { name: 'lawyer_profile_imports_parse_queue_idx', fields: ['status', 'updated_at', 'created_at'] },
    { name: 'lawyer_profile_imports_retention_queue_idx', fields: ['status', 'expires_at', 'confirmed_at'] },
  ],
});

const ProfileImportAudit = sequelize.define('ProfileImportAudit', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  importId: { type: DataTypes.UUID, allowNull: true },
  ownerUserId: { type: DataTypes.UUID, allowNull: false },
  actorUserId: { type: DataTypes.UUID, allowNull: true },
  event: {
    type: DataTypes.STRING(40),
    allowNull: false,
    validate: {
      isIn: [[
        'admin_view', 'admin_download', 'owner_delete', 'retention_cleanup',
        'profile_review_cleanup', 'field_verified',
      ]],
    },
  },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'profile_import_audits',
  updatedAt: false,
  indexes: [{ name: 'profile_import_audits_expiry_idx', fields: ['expires_at'] }],
});

const AuthorizationEvidenceEvent = sequelize.define('AuthorizationEvidenceEvent', {
  eventId: { type: DataTypes.STRING(160), primaryKey: true },
  schemaVersion: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1 },
  type: { type: DataTypes.STRING(16), allowNull: false, validate: { isIn: [['decision', 'canary']] } },
  observedAt: { type: DataTypes.DATE, allowNull: false },
  commitSha: { type: DataTypes.CHAR(40), allowNull: false, validate: { is: /^[a-f0-9]{40}$/ } },
  deploymentId: { type: DataTypes.STRING(160), allowNull: false },
  serviceId: { type: DataTypes.STRING(160), allowNull: false },
  configDigest: { type: DataTypes.CHAR(64), allowNull: false, validate: { is: /^[a-f0-9]{64}$/ } },
  migrationHead: { type: DataTypes.STRING(255), allowNull: false },
  authorizationMode: {
    type: DataTypes.STRING(24), allowNull: false,
    validate: { isIn: [['compatibility', 'capability_only']] },
  },
  channel: { type: DataTypes.STRING(16), allowNull: true },
  surface: { type: DataTypes.STRING(160), allowNull: true },
  mode: { type: DataTypes.STRING(16), allowNull: true },
  legacyAllowed: { type: DataTypes.BOOLEAN, allowNull: true },
  capabilityAllowed: { type: DataTypes.BOOLEAN, allowNull: true },
}, {
  tableName: 'authorization_evidence_events',
  updatedAt: false,
  indexes: [
    { name: 'authorization_evidence_events_deployment_time_idx', fields: ['deployment_id', 'observed_at'] },
    { name: 'authorization_evidence_events_surface_mode_time_idx', fields: ['surface', 'mode', 'observed_at'] },
  ],
});

// ─── ASSOCIATIONS ───────────────────────────────────────────

// User <-> LawyerProfile (1:1 for lawyers)
User.hasOne(LawyerProfile, { foreignKey: 'userId', as: 'profile' });
LawyerProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(LawyerProfileImport, { foreignKey: 'userId', as: 'profileImports', onDelete: 'CASCADE' });
LawyerProfileImport.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(AuthChallenge, { foreignKey: 'userId', as: 'authChallenges', onDelete: 'CASCADE' });
AuthChallenge.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Client <-> Consultation
User.hasMany(Consultation, { foreignKey: 'clientId', as: 'clientConsultations' });
Consultation.belongsTo(User, { foreignKey: 'clientId', as: 'client' });

// Lawyer <-> Consultation
User.hasMany(Consultation, { foreignKey: 'lawyerId', as: 'lawyerConsultations' });
Consultation.belongsTo(User, { foreignKey: 'lawyerId', as: 'lawyer' });

// User <-> AIConversation
User.hasMany(AIConversation, { foreignKey: 'userId', as: 'conversations' });
AIConversation.belongsTo(User, { foreignKey: 'userId' });

// AIConversation <-> AIMessage
AIConversation.hasMany(AIMessage, { foreignKey: 'conversationId', as: 'messages' });
AIMessage.belongsTo(AIConversation, { foreignKey: 'conversationId' });

// User <-> Document
User.hasMany(Document, { foreignKey: 'userId', as: 'documents' });
Document.belongsTo(User, { foreignKey: 'userId' });

// Lawyer (User) <-> LawyerDocument (верификационные документы)
User.hasMany(LawyerDocument, { foreignKey: 'userId', as: 'lawyerDocuments' });
LawyerDocument.belongsTo(User, { foreignKey: 'userId' });

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

// Payment <-> Consultation. Keep the unaliased belongsTo for legacy includes.
Consultation.hasMany(Payment, { foreignKey: 'consultationId', as: 'payments' });
Payment.belongsTo(Consultation, { foreignKey: 'consultationId' });
Payment.belongsTo(Consultation, { foreignKey: 'consultationId', as: 'consultation' });

// Payment <-> Subscription
Subscription.hasMany(Payment, { foreignKey: 'subscriptionId', as: 'payments' });
Payment.belongsTo(Subscription, { foreignKey: 'subscriptionId', as: 'subscription' });

PromotionPackage.hasMany(LawyerPromotion, { foreignKey: 'packageId', as: 'campaigns' });
LawyerPromotion.belongsTo(PromotionPackage, { foreignKey: 'packageId', as: 'package' });
User.hasMany(LawyerPromotion, { foreignKey: 'lawyerId', as: 'promotions' });
LawyerPromotion.belongsTo(User, { foreignKey: 'lawyerId', as: 'lawyer' });
LawyerPromotion.hasOne(Payment, { foreignKey: 'lawyerPromotionId', as: 'payment', constraints: false });
Payment.belongsTo(LawyerPromotion, { foreignKey: 'lawyerPromotionId', as: 'lawyerPromotion', constraints: false });
LawyerPromotion.belongsTo(Payment, { foreignKey: 'paymentId', as: 'purchasePayment', constraints: false });

// Payment <-> User (payer)
User.hasMany(Payment, { foreignKey: 'userId', as: 'payments' });
Payment.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Payment.hasMany(FinancialTransaction, { foreignKey: 'paymentId', as: 'financialTransactions' });
FinancialTransaction.belongsTo(Payment, { foreignKey: 'paymentId', as: 'payment' });
FinancialTransaction.hasMany(FinancialEntry, { foreignKey: 'financialTransactionId', as: 'entries' });
FinancialEntry.belongsTo(FinancialTransaction, { foreignKey: 'financialTransactionId', as: 'transaction' });
User.hasMany(PlatformSettingAudit, { foreignKey: 'changedByUserId', as: 'platformSettingChanges' });
PlatformSettingAudit.belongsTo(User, { foreignKey: 'changedByUserId', as: 'changedBy' });

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
  Consultation,
  AIConversation,
  AIMessage,
  Document,
  LawyerDocument,
  CaseDocument,
  Review,
  Notification,
  Specialization,
  Message,
  FavoriteLawyer,
  PromotionPackage,
  LawyerPromotion,
  Payment,
  FinancialTransaction,
  FinancialEntry,
  PlatformSetting,
  PlatformSettingAudit,
  Subscription,
  SupportTicket,
  Promo,
  Withdrawal,
  PushSubscription,
  PhoneOtp,
  AuthChallenge,
  ObjectCleanupTask,
  LawyerProfileImport,
  ProfileImportAudit,
  AuthorizationEvidenceEvent,
};

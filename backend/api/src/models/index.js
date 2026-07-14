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
  return values;
};

// ─── LAWYER PROFILE MODEL ───────────────────────────────────
const LawyerProfile = sequelize.define('LawyerProfile', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  specialization: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
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
  description: {
    type: DataTypes.TEXT,
  },
  preferredDate: {
    type: DataTypes.DATEONLY,
  },
  preferredTime: {
    type: DataTypes.STRING,
  },
  price: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  videoRoomUrl: {
    type: DataTypes.STRING,
  },
  notes: {
    type: DataTypes.TEXT,
  },
  rating: {
    type: DataTypes.INTEGER,
  },
  review: {
    type: DataTypes.TEXT,
  },
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
  },
  status: {
    type: DataTypes.ENUM('pending', 'verified', 'issues', 'rejected'),
    defaultValue: 'pending',
  },
  aiAnalysis: {
    type: DataTypes.JSONB,
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
});

// ─── ASSOCIATIONS ───────────────────────────────────────────

// User <-> LawyerProfile (1:1 for lawyers)
User.hasOne(LawyerProfile, { foreignKey: 'userId', as: 'profile' });
LawyerProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });

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
Consultation.hasOne(Payment, { foreignKey: 'consultationId', as: 'payment' });
Payment.belongsTo(Consultation, { foreignKey: 'consultationId' });

// Payment <-> User (payer)
User.hasMany(Payment, { foreignKey: 'userId', as: 'payments' });
Payment.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User <-> Subscription (1:1 — у каждого пользователя одна активная подписка)
User.hasOne(Subscription, { foreignKey: 'userId', as: 'subscription' });
Subscription.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  LawyerProfile,
  Consultation,
  AIConversation,
  AIMessage,
  Document,
  Review,
  Notification,
  Specialization,
  Message,
  FavoriteLawyer,
  Payment,
  Subscription,
};

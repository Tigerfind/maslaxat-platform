const express = require('express');
const { Op } = require('sequelize');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const {
  sequelize,
  User,
  LawyerProfile,
  Consultation,
  Review,
  Specialization,
  SupportTicket,
  Promo,
  LawyerDocument,
  LawyerPromotion,
  Payment,
  PlatformSettingAudit,
  PromotionPackage,
  ConsultationMeeting,
  MeetingEvent,
  ZoomConnection,
  LawyerExperience,
  LawyerEducation,
  LawyerCertificate,
  LawyerProfileStatusHistory,
  Withdrawal,
  FinancialEvent,
} = require('../models');
const { authenticate, authorizeCompat, evaluateAuthorizationDecision } = require('../middleware/auth');
const { getAuthorizationMode, recordAuthorizationDecision } = require('../services/authorizationRuntime');
const { resolveHttpAuthorizationSurface } = require('../config/authorizationSurfaces');
const { recomputeLawyerRating } = require('../services/ratingService');
const { withLawyerCounts } = require('../services/specializationStats');
const notifications = require('../services/notificationService');
const { getCommissionRateBps, setCommissionRateBps } = require('../services/platformSettingsService');
const { earnedPromotionTiyin } = require('../services/promotionService');
const profileImportService = require('../services/profileImportService');
const { computeProfileCompleteness } = require('../services/lawyerProfileCompleteness');
const { getFileStorageService } = require('../services/fileStorageRuntime');
const { streamFile } = require('../services/fileHttpService');
const { FILE_LIMITS } = require('../config/fileLimits');
const { registerUuidParams } = require('../middleware/uuidParams');
const { disconnectUserSockets } = require('../socket/io');
const {
  serializeCampaign,
  serializePackage,
  serializePayment,
  validate,
} = require('./promotions');

function createAdminPortalRouter({ fileStorageService = getFileStorageService() } = {}) {
const router = express.Router();

function targetCapabilityAllowed(user, profile) {
  return Boolean(user?.accountType === 'member' && profile);
}

async function decideLawyerTarget(req, user, profile) {
  return evaluateAuthorizationDecision({
    authorizationMode: getAuthorizationMode(),
    channel: 'http',
    surface: resolveHttpAuthorizationSurface(req.method, req.originalUrl, 'target'),
    mode: 'admin',
    legacyAllowed: Boolean(user?.role === 'lawyer'),
    capabilityAllowed: targetCapabilityAllowed(user, profile),
    recordDecision: recordAuthorizationDecision,
    compatibilityAuthority: 'legacy',
  });
}

async function loadAdminLawyerTarget(req, res, next) {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [{ model: LawyerProfile, as: 'profile', required: false }],
    });
    if (!user) return res.status(404).json({ error: 'Юрист не найден' });
    const decision = await decideLawyerTarget(req, user, user.profile);
    if (!decision.allowed) return res.status(404).json({ error: 'Юрист не найден' });
    req.lawyerTarget = user;
    return next();
  } catch (error) {
    return next(error);
  }
}
loadAdminLawyerTarget.authorizationGuard = {
  legacyRoles: ['lawyer'], modes: ['admin'], stage: 'target',
};

async function loadAdminLawyerListTargets(req, res, next) {
  try {
    const where = req.query.search ? { name: { [Op.iLike]: `%${req.query.search}%` } } : {};
    const candidates = await User.findAll({
      where,
      include: [{ model: LawyerProfile, as: 'profile', required: false }],
      order: [['createdAt', 'DESC']],
    });
    const allowed = [];
    for (const user of candidates) {
      const decision = await decideLawyerTarget(req, user, user.profile);
      if (decision.allowed) allowed.push(user);
    }
    req.lawyerTargets = allowed;
    return next();
  } catch (error) {
    return next(error);
  }
}
loadAdminLawyerListTargets.authorizationGuard = {
  legacyRoles: ['lawyer'], modes: ['admin'], stage: 'target',
};
registerUuidParams(router, 'id', 'docId');

async function deleteVerificationDocument(doc) {
  const destroy = async ({ transaction }) => {
    const profile = await LawyerProfile.findOne({
      where: { userId: doc.userId }, transaction, lock: transaction.LOCK.UPDATE,
    });
    const locked = await LawyerDocument.findOne({
      where: { id: doc.id, userId: doc.userId }, transaction, lock: transaction.LOCK.UPDATE,
    });
    if (!locked) return;
    if (profile) {
      await profileImportService.invalidateDocumentProvenance({
        userId: doc.userId,
        documentId: doc.id,
        transaction,
        lockedProfile: profile,
      });
    }
    await locked.destroy({ transaction });
  };
  if (doc.storageKey) return fileStorageService.delete({ record: doc, destroy });
  return sequelize.transaction((transaction) => destroy({ transaction }));
}

// All routes require admin authentication
router.use(authenticate, authorizeCompat({
  legacyRoles: ['admin'],
  capability: 'admin',
  telemetryName: 'http.admin',
}));

const promotionMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много административных изменений продвижения' },
});

const promotionUuid = Joi.string().guid({ version: ['uuidv4'] });
const localizedName = Joi.object({
  ru: Joi.string().trim().min(1).max(120).required(),
  uz: Joi.string().trim().min(1).max(120).required(),
  en: Joi.string().trim().min(1).max(120).required(),
}).unknown(false);
const promotionPackageSchema = Joi.object({
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]+$/).min(3).max(64).required(),
  name: localizedName.required(),
  placement: Joi.string().valid('catalog_top').required(),
  durationDays: Joi.number().integer().valid(7, 30).required(),
  priceAmountTiyin: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required(),
  currency: Joi.string().valid('UZS').required(),
  maxActiveSlots: Joi.number().integer().min(1).max(100).required(),
  sponsoredPositions: Joi.array().items(Joi.number().integer().min(0).max(19))
    .min(1).max(2).unique().required(),
  displayOrder: Joi.number().integer().min(-10000).max(10000).default(0),
  isActive: Joi.forbidden(),
}).unknown(false);
const promotionPackageUpdateSchema = promotionPackageSchema.keys({ isActive: Joi.forbidden() });
const promotionReasonSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(120).required(),
}).unknown(false);
const promotionActivationSchema = promotionReasonSchema.keys({ isActive: Joi.boolean().required() });
const promotionPilotSchema = Joi.object({
  enabled: Joi.boolean().required(),
  reason: Joi.string().trim().min(3).max(120).required(),
}).unknown(false);
const promotionCampaignQuerySchema = Joi.object({
  status: Joi.string().valid(
    'pending_payment', 'queued', 'scheduled', 'active', 'paused', 'expired',
    'cancelled', 'refund_pending', 'refunded'
  ),
  lawyerId: promotionUuid,
  packageId: promotionUuid,
  specialization: Joi.string().trim().min(1).max(120),
  location: Joi.string().trim().min(1).max(120),
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);
const promotionIdSchema = Joi.object({ id: promotionUuid.required() }).unknown(false);
const promotionPackageQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);
const promotionDocumentParamsSchema = Joi.object({
  id: promotionUuid.required(),
  docId: promotionUuid.required(),
}).unknown(false);
const promotionDocumentStatusSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
  reason: Joi.string().trim().min(3).max(120).required(),
}).unknown(false);

function promotionSnapshot(row) {
  return serializePackage(row, { admin: true });
}

async function promotionAudit({ key, oldValue, newValue, actorId, transaction }) {
  return PlatformSettingAudit.create({
    key,
    oldValue: JSON.stringify(oldValue),
    newValue: JSON.stringify(newValue),
    changedByUserId: actorId,
  }, { transaction });
}

function promotionAdminError(res, next, error) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: 'Пакет с таким кодом уже существует' });
  }
  return next(error);
}

router.get('/settings/commission-rate', async (req, res, next) => {
  try {
    res.json({ commissionRateBps: await getCommissionRateBps() });
  } catch (err) {
    next(err);
  }
});

router.patch('/settings/commission-rate', async (req, res, next) => {
  try {
    const rate = Number(req.body.commissionRateBps);
    if (!Number.isInteger(rate) || rate < 0 || rate > 5000) {
      return res.status(400).json({ error: 'Комиссия должна быть целым числом от 0 до 5000 базисных пунктов' });
    }
    const commissionRateBps = await setCommissionRateBps(rate, req.userId);
    res.json({ commissionRateBps });
  } catch (err) {
    next(err);
  }
});

// ─── RECENT ACTIVITY ────────────────────────────────────────

// GET /activity/recent — recent platform activity
router.get('/activity/recent', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    // Gather recent consultations as activity
    const recentConsultations = await Consultation.findAll({
      include: [
        { model: User, as: 'client', attributes: ['id', 'name'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
    });

    // Текст и дату собирает фронт по текущему языку: раньше бэкенд отдавал готовые
    // русские строки и дату 'ru-RU', и админ с UZ/EN интерфейсом всё равно видел
    // «Новый юрист: …» и «12 авг.». Отсюда — только данные.
    const STATUS_TO_TYPE = {
      pending: 'consultation_pending',
      accepted: 'consultation_accepted',
      completed: 'consultation_completed',
      cancelled: 'consultation_cancelled',
    };

    const activity = recentConsultations.map((c) => ({
      type: STATUS_TO_TYPE[c.status] || 'consultation_other',
      status: c.status,
      clientName: c.client?.name || null,
      lawyerName: c.lawyer?.name || null,
      userName: c.client?.name || null,
      createdAt: c.createdAt,
      ts: new Date(c.createdAt).getTime(), // сырой timestamp для сортировки
    }));

    // Also add recent user registrations
    const recentUsers = await User.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      attributes: ['id', 'name', 'role', 'createdAt'],
    });

    recentUsers.forEach((u) => {
      activity.push({
        type: 'user_registration',
        role: u.role,
        userName: u.name,
        createdAt: u.createdAt,
        ts: new Date(u.createdAt).getTime(),
      });
    });

    // Sort by raw timestamp (newest first) — раньше сортировали по локализованной строке (NaN)
    activity.sort((a, b) => b.ts - a.ts);

    // ts — служебное поле для сортировки, наружу не отдаём
    res.json(activity.slice(0, parseInt(limit)).map(({ ts, ...rest }) => rest));
  } catch (err) {
    next(err);
  }
});

// ─── USERS MANAGEMENT ───────────────────────────────────────

// GET /users — list all users
router.get('/users', async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (role) where.role = role;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Счётчики считаем по ВСЕЙ таблице, а не по выданной странице: KPI-карточки
    // на фронте раньше брались из users.length и при limit=50 показывали «Всего: 50».
    const [{ count, rows }, all, clients, lawyers, blocked] = await Promise.all([
      User.findAndCountAll({
        where,
        attributes: ['id', 'name', 'email', 'role', 'isActive', 'isVerified', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      User.count(),
      User.count({ where: { role: 'client' } }),
      User.count({ where: { role: 'lawyer' } }),
      User.count({ where: { isActive: false } }),
    ]);

    res.json({
      users: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, clients, lawyers, blocked },
    });
  } catch (err) {
    next(err);
  }
});

// GET /users/:id — user details
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [{ model: LawyerProfile, as: 'profile' }],
    });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /users/:id/status — toggle active/blocked
router.put('/users/:id/status', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    user.isActive = req.body.status === 'active';
    await user.save();
    if (!user.isActive) disconnectUserSockets(user.id);

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// ─── LAWYERS MANAGEMENT ─────────────────────────────────────

// GET /lawyers — list all lawyers with profiles
router.get('/lawyers', loadAdminLawyerListTargets, async (req, res, next) => {
  try {
    const { verified, status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Фильтр по статусу модерации (на профиле). verified=true → одобренные,
    // verified=false → на проверке (очередь для админа).
    const profileWhere = {};
    if (['draft', 'pending_review', 'approved', 'rejected', 'suspended'].includes(status)) {
      profileWhere.verificationStatus = status;
    } else if (verified === 'true') {
      profileWhere.verificationStatus = 'approved';
    } else if (verified === 'false') {
      profileWhere.verificationStatus = 'pending_review';
    }

    const filtered = req.lawyerTargets.filter((user) => !Object.keys(profileWhere).length
      || user.profile?.verificationStatus === profileWhere.verificationStatus);
    const count = filtered.length;
    const rows = filtered.slice(offset, offset + parseInt(limit));
    const lawyers = rows;
    const all = req.lawyerTargets.length;
    const approved = req.lawyerTargets.filter((user) => user.profile?.verificationStatus === 'approved').length;
    const pending = req.lawyerTargets.filter((user) => user.profile?.verificationStatus === 'pending_review').length;
    const rejected = req.lawyerTargets.filter((user) => user.profile?.verificationStatus === 'rejected').length;

    res.json({
      lawyers,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, approved, pending, rejected },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/lawyers/:id/moderation', async (req, res, next) => {
  try {
    const lawyer = await User.findOne({
      where: { id: req.params.id, role: 'lawyer' },
      attributes: ['id', 'name', 'email', 'phone', 'avatar', 'isVerified', 'isActive'],
      include: [
        { model: LawyerProfile, as: 'profile' },
        { model: LawyerExperience, as: 'lawyerExperiences', separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerEducation, as: 'lawyerEducations', separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerCertificate, as: 'lawyerCertificates', separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerDocument, as: 'lawyerDocuments', separate: true, attributes: ['id', 'type', 'name', 'mimeType', 'size', 'verifiedAt', 'createdAt'] },
      ],
    });
    if (!lawyer?.profile) return res.status(404).json({ error: 'Юрист не найден' });
    const history = await LawyerProfileStatusHistory.findAll({
      where: { lawyerProfileId: lawyer.profile.id },
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'role'] }],
      order: [['createdAt', 'DESC']],
    });
    return res.json({ lawyer, history, completeness: await computeProfileCompleteness(lawyer.id) });
  } catch (error) {
    return next(error);
  }
});

// POST /lawyers/:id/approve — approve lawyer verification
router.post('/lawyers/:id/approve', loadAdminLawyerTarget, async (req, res, next) => {
  try {
    const user = await sequelize.transaction(async (transaction) => {
      const lockedUser = await User.findOne({
        where: { id: req.params.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!lockedUser) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      if (!lockedUser.twoFactorEnabled || !lockedUser.twoFactorSecret) {
        const error = new Error('Юрист должен включить 2FA до одобрения');
        error.status = 409;
        error.code = 'LAWYER_2FA_REQUIRED';
        throw error;
      }
      const profile = await LawyerProfile.findOne({
        where: { userId: lockedUser.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!profile) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      if (!['pending_review', 'pending'].includes(profile.verificationStatus)) {
        const error = new Error('Профиль не ожидает проверки');
        error.status = 409;
        throw error;
      }
      if (!targetCapabilityAllowed(lockedUser, profile)) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      const completeness = await computeProfileCompleteness(lockedUser.id, { transaction });
      if (!completeness.complete) {
        const error = new Error('PROFILE_INCOMPLETE');
        error.status = 400;
        error.missing = completeness.missing;
        throw error;
      }
      await profileImportService.scheduleReviewedImportCleanup({
        userId: lockedUser.id,
        transaction,
      });
      const fromStatus = profile.verificationStatus;
      await profile.update({
        verificationStatus: 'approved',
        operatingStatus: 'enabled',
        rejectionReason: null,
        isAvailable: true,
        schedulePolicyAcceptedAt: new Date(),
      }, { transaction });
      await LawyerDocument.update(
        { verificationStatus: 'approved', approvedAt: new Date(), approvedByUserId: req.userId, verifiedAt: new Date(), verifiedBy: req.userId },
        { where: { userId: lockedUser.id, verifiedAt: null }, transaction },
      );
      await LawyerProfileStatusHistory.create({
        lawyerProfileId: profile.id, actorUserId: req.userId,
        fromStatus, toStatus: 'approved', metadata: { source: 'admin_review' },
      }, { transaction });
      if (!lockedUser.isActive) await lockedUser.update({ isActive: true }, { transaction });
      return lockedUser;
    });
    disconnectUserSockets(user.id);

    // Уведомляем юриста об одобрении (fail-safe: ошибка уведомления не валит запрос)
    try {
      await notifications.createNotification(
        user.id,
        'verification',
        'Профиль одобрен',
        'Поздравляем! Ваш профиль прошёл проверку — теперь вы видны клиентам в каталоге.',
      );
    } catch (e) { /* notification is best-effort */ }

    const responseUser = await User.findByPk(user.id, {
      include: [{ model: LawyerProfile, as: 'profile' }],
    });
    res.json({ success: true, message: 'Юрист одобрен', user: responseUser });
  } catch (err) {
    if (err.message === 'PROFILE_INCOMPLETE') return res.status(400).json({ error: 'Профиль юриста заполнен не полностью', missing: err.missing });
    if (err.status) return res.status(err.status).json({
      error: err.code === 'LAWYER_2FA_REQUIRED' ? err.message : 'Решение уже принято другим администратором',
      ...(err.code ? { code: err.code } : {}),
    });
    next(err);
  }
});

// POST /lawyers/:id/reject — reject lawyer (с причиной)
router.post('/lawyers/:id/reject', loadAdminLawyerTarget, async (req, res, next) => {
  try {
    const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason.trim().slice(0, 500) : '';
    if (!reason) return res.status(400).json({ error: 'Укажите причину отклонения' });
    const user = await sequelize.transaction(async (transaction) => {
      const lockedUser = await User.findOne({
        where: { id: req.params.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!lockedUser) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      const profile = await LawyerProfile.findOne({
        where: { userId: lockedUser.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!profile) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      if (!['pending_review', 'pending'].includes(profile.verificationStatus)) {
        const error = new Error('Профиль не ожидает проверки');
        error.status = 409;
        throw error;
      }
      if (!targetCapabilityAllowed(lockedUser, profile)) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      await profileImportService.scheduleReviewedImportCleanup({
        userId: lockedUser.id,
        transaction,
      });
      const fromStatus = profile.verificationStatus;
      await profile.update({
        verificationStatus: 'rejected',
        rejectionReason: reason || null,
        operatingStatus: 'suspended',
        isAvailable: false,
      }, { transaction });
      await LawyerProfileStatusHistory.create({
        lawyerProfileId: profile.id, actorUserId: req.userId,
        fromStatus, toStatus: 'rejected', reason, metadata: { source: 'admin_review' },
      }, { transaction });
      return lockedUser;
    });
    disconnectUserSockets(user.id);

    try {
      await notifications.createNotification(
        user.id,
        'verification',
        'Профиль отклонён',
        reason
          ? `Профиль не прошёл проверку: ${reason}. Исправьте и подайте снова.`
          : 'Профиль не прошёл проверку. Проверьте данные и документы и подайте снова.',
      );
    } catch (e) { /* notification is best-effort */ }

    const responseUser = await User.findByPk(user.id, {
      include: [{ model: LawyerProfile, as: 'profile' }],
    });
    res.json({ success: true, message: 'Юрист отклонён', user: responseUser });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: 'Решение уже принято другим администратором' });
    next(err);
  }
});

// GET /lawyers/:id/verification-documents — верификационные документы юриста (для проверки)
router.get('/lawyers/:id/verification-documents', async (req, res, next) => {
  try {
    const docs = await LawyerDocument.findAll({
      where: { userId: req.params.id },
      attributes: ['id', 'type', 'name', 'mimeType', 'size', 'verificationStatus', 'approvedByUserId', 'approvedAt', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

router.patch('/lawyers/:id/verification-documents/:docId/verify', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({ where: { id: req.params.docId, userId: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    await doc.update({ verifiedAt: doc.verifiedAt || new Date(), verifiedBy: req.userId });
    return res.json({ document: { id: doc.id, type: doc.type, verifiedAt: doc.verifiedAt } });
  } catch (error) {
    return next(error);
  }
});

// GET /lawyers/:id/verification-documents/:docId/download — скачать файл документа (только админ)
router.get('/lawyers/:id/verification-documents/:docId/download', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({
      where: { id: req.params.docId, userId: req.params.id },
    });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    await streamFile({
      storage: fileStorageService, req, res, record: doc, filename: doc.name,
      maxBytes: FILE_LIMITS.lawyer,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/lawyers/:id/verification-documents/:docId', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({
      where: { id: req.params.docId, userId: req.params.id },
    });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    await deleteVerificationDocument(doc);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.patch('/lawyers/:id/verification-documents/:docId/status', promotionMutationLimiter, async (req, res, next) => {
  try {
    const { id, docId } = validate(promotionDocumentParamsSchema, req.params);
    const body = validate(promotionDocumentStatusSchema, req.body);
    const document = await sequelize.transaction(async (transaction) => {
      const profile = await LawyerProfile.findOne({
        where: { userId: id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!profile) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      const row = await LawyerDocument.findOne({
        where: { id: docId, userId: id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!row) {
        const error = new Error('Документ не найден');
        error.status = 404;
        throw error;
      }
      const oldValue = { documentId: row.id, type: row.type, status: row.verificationStatus };
      await row.update({
        verificationStatus: body.status,
        approvedByUserId: body.status === 'approved' ? req.userId : null,
        approvedAt: body.status === 'approved' ? new Date() : null,
      }, { transaction });
      if (body.status === 'rejected') {
        await profileImportService.invalidateDocumentProvenance({
          userId: id,
          documentId: row.id,
          transaction,
          lockedProfile: profile,
        });
      }
      await promotionAudit({
        key: `lawyer_document:${row.id}:verification`,
        oldValue,
        newValue: { documentId: row.id, type: row.type, status: body.status, reason: body.reason },
        actorId: req.userId,
        transaction,
      });
      return row;
    });
    return res.json({
      document: {
        id: document.id,
        type: document.type,
        verificationStatus: document.verificationStatus,
        approvedByUserId: document.approvedByUserId,
        approvedAt: document.approvedAt,
      },
    });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

router.patch('/lawyers/:id/profile-fields/:field/verify', promotionMutationLimiter, async (req, res, next) => {
  try {
    if (!req.body || typeof req.body.documentId !== 'string') {
      return res.status(400).json({ code: 'VERIFICATION_DOCUMENT_REQUIRED' });
    }
    const profile = await profileImportService.verifyProfileField({
      userId: req.params.id,
      field: req.params.field,
      documentId: req.body.documentId,
      reviewerUserId: req.userId,
    });
    return res.json({
      field: req.params.field,
      provenance: profile.profileSources[req.params.field],
      verifiedAt: profile.verifiedAt,
    });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

// ─── SPECIALIZATIONS ────────────────────────────────────────

// GET /specializations — list all
router.get('/specializations', async (req, res, next) => {
  try {
    const specializations = await Specialization.findAll({
      order: [['name', 'ASC']],
    });
    // lawyerCount из колонки — стухший литерал из сида (у всех «1»). Считаем реально,
    // тем же способом, что и публичный каталог.
    res.json(await withLawyerCounts(specializations));
  } catch (err) {
    next(err);
  }
});

// POST /specializations — create
router.post('/specializations', async (req, res, next) => {
  try {
    const { name, nameUz, nameEn, icon } = req.body;
    const specialization = await Specialization.create({
      name,
      nameUz: nameUz || null,
      nameEn: nameEn || null,
      icon: icon || 'Gavel',
    });
    res.status(201).json(specialization);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Специализация с таким названием уже существует' });
    }
    next(err);
  }
});

// PUT /specializations/:id — update
router.put('/specializations/:id', async (req, res, next) => {
  try {
    const specialization = await Specialization.findByPk(req.params.id);
    if (!specialization) {
      return res.status(404).json({ error: 'Специализация не найдена' });
    }

    const { name, nameUz, nameEn, icon, isActive } = req.body;
    const oldName = specialization.name;
    const renaming = name !== undefined && name !== oldName;

    if (name !== undefined) specialization.name = name;
    if (nameUz !== undefined) specialization.nameUz = nameUz;
    if (nameEn !== undefined) specialization.nameEn = nameEn;
    if (icon !== undefined) specialization.icon = icon;
    if (isActive !== undefined) specialization.isActive = isActive;

    // Специализации хранятся у юристов строками без FK: простое переименование
    // молча осиротило бы все профили со старым названием (юрист выпадал из
    // фильтра каталога). Переносим их в одной транзакции с самим переименованием.
    let migratedProfiles = 0;
    await Specialization.sequelize.transaction(async (t) => {
      await specialization.save({ transaction: t });
      if (renaming) {
        const [affected] = await LawyerProfile.update(
          { specialization: name },
          { where: { specialization: oldName }, transaction: t }
        );
        migratedProfiles = affected;
        // Массив specializations — тот же перенос по элементу массива
        await LawyerProfile.sequelize.query(
          `UPDATE lawyer_profiles
             SET specializations = array_replace(specializations, :oldName, :newName)
           WHERE :oldName = ANY(specializations)`,
          { replacements: { oldName, newName: name }, transaction: t }
        );
      }
    });

    res.json({ ...specialization.toJSON(), migratedProfiles });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Специализация с таким названием уже существует' });
    }
    next(err);
  }
});

// DELETE /specializations/:id — delete
// Удаление используемой специализации осиротило бы профили юристов (FK нет),
// поэтому по умолчанию блокируем и сообщаем, скольких это затронет.
router.delete('/specializations/:id', async (req, res, next) => {
  try {
    const specialization = await Specialization.findByPk(req.params.id);
    if (!specialization) {
      return res.status(404).json({ error: 'Специализация не найдена' });
    }

    const inUse = await LawyerProfile.count({ where: { specialization: specialization.name } });
    if (inUse > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        error: `Специализация используется у ${inUse} юрист(ов). Переименуйте её или отключите вместо удаления.`,
        inUse,
      });
    }

    await specialization.destroy();
    res.json({ success: true, message: 'Специализация удалена', inUse });
  } catch (err) {
    next(err);
  }
});

// ─── CONSULTATIONS MONITORING ───────────────────────────────

// GET /consultations — all consultations
router.get('/consultations', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status && status !== 'all') where.status = status;

    const { count, rows } = await Consultation.findAndCountAll({
      where,
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'email'],
          include: [{ model: LawyerProfile, as: 'profile' }],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      consultations: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/consultations/:id/meeting-diagnostics', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      attributes: ['id', 'status', 'lifecycleStatus', 'duration', 'scheduledStartAt', 'scheduledEndAt', 'scheduleTimezone', 'meetingProvider', 'lawyerFirstJoinedAt', 'clientFirstJoinedAt', 'conversationStartedAt', 'finalLeftAt', 'graceEndsAt'],
      include: [{
        model: ConsultationMeeting, as: 'meeting',
        attributes: ['id', 'provider', 'externalMeetingId', 'status', 'desiredState', 'pendingOperation', 'attemptCount', 'nextAttemptAt', 'lastAttemptAt', 'lastHttpStatus', 'providerRequestId', 'lastSafeError', 'startedAt', 'endedAt', 'scheduledAt', 'duration'],
        include: [{ model: ZoomConnection, as: 'zoomConnection', attributes: ['status', 'connectedAt', 'tokenExpiresAt', 'lastError'] }],
      }],
    });
    if (!consultation) return res.status(404).json({ error: 'Консультация не найдена' });
    const events = await MeetingEvent.findAll({
      where: { consultationId: consultation.id },
      attributes: ['id', 'eventType', 'participantRole', 'occurredAt', 'correlationId', 'metadata'],
      order: [['occurredAt', 'DESC']], limit: 100,
    });
    return res.json({ consultation, events });
  } catch (error) { return next(error); }
});

router.post('/consultations/:id/meeting/retry', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation || consultation.meetingProvider !== 'zoom') return res.status(404).json({ error: 'Zoom-консультация не найдена' });
    const service = require('../services/zoomMeetingService');
    const existing = await ConsultationMeeting.findOne({ where: { consultationId: consultation.id }, attributes: ['externalMeetingId', 'status'] });
    const operation = ['cancelled', 'rejected'].includes(consultation.status)
      ? 'cancel'
      : consultation.lifecycleStatus === 'completed' ? 'end'
        : existing?.externalMeetingId ? 'update' : 'create';
    if (!existing && !['accepted'].includes(consultation.status)) return res.status(409).json({ error: 'Повторная операция недоступна в текущем статусе' });
    const meeting = await service.queueOperation(consultation.id, operation);
    setImmediate(() => service.processMeetingOperation(meeting.id).catch(() => {}));
    return res.status(202).json({ status: 'meeting_creating' });
  } catch (error) { return next(error); }
});

router.get('/meeting-metrics', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, ready, failed, backlog, joined, reconnects, connectedConsultations] = await Promise.all([
      ConsultationMeeting.count({ where: { provider: 'zoom', createdAt: { [Op.gte]: since } } }),
      ConsultationMeeting.count({ where: { provider: 'zoom', status: { [Op.in]: ['ready', 'started', 'ended'] }, createdAt: { [Op.gte]: since } } }),
      ConsultationMeeting.count({ where: { provider: 'zoom', status: 'failed', createdAt: { [Op.gte]: since } } }),
      ConsultationMeeting.count({ where: { pendingOperation: { [Op.ne]: null } } }),
      MeetingEvent.count({ where: { eventType: 'join_succeeded', occurredAt: { [Op.gte]: since } } }),
      MeetingEvent.count({ where: { eventType: 'reconnect_started', occurredAt: { [Op.gte]: since } } }),
      Consultation.findAll({ where: { meetingProvider: 'zoom', conversationStartedAt: { [Op.ne]: null }, createdAt: { [Op.gte]: since } }, attributes: ['scheduledStartAt', 'conversationStartedAt'], raw: true }),
    ]);
    const delays = connectedConsultations.map((item) => Math.max(0, (new Date(item.conversationStartedAt) - new Date(item.scheduledStartAt)) / 1000));
    return res.json({
      periodDays: 30, meetingCreateSuccessRate: total ? Math.round((ready / total) * 1000) / 10 : null,
      connectionSuccessRate: total ? Math.round((connectedConsultations.length / total) * 1000) / 10 : null,
      averageConnectionDelaySeconds: delays.length ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : null,
      total, ready, failed, backlog, successfulJoins: joined, reconnects,
    });
  } catch (error) { return next(error); }
});

// ─── WITHDRAWALS AND PAYMENTS ───────────────────────────────
router.get('/withdrawals', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;
    const where = {};
    if (['pending', 'processing', 'paid', 'failed', 'cancelled'].includes(status)) where.status = status;
    const [{ count, rows }, all, pending, processing, paid, pendingSum] = await Promise.all([
      Withdrawal.findAndCountAll({
        where,
        include: [{
          model: User, as: 'lawyer', attributes: ['id', 'name', 'email'],
          include: [{ model: LawyerProfile, as: 'profile', attributes: ['balance', 'pendingBalance'] }],
        }],
        order: [['createdAt', 'DESC']], limit: parseInt(limit, 10), offset,
      }),
      Withdrawal.count(),
      Withdrawal.count({ where: { status: 'pending' } }),
      Withdrawal.count({ where: { status: 'processing' } }),
      Withdrawal.count({ where: { status: 'paid' } }),
      Withdrawal.sum('amount', { where: { status: { [Op.in]: ['pending', 'processing'] } } }),
    ]);
    res.json({
      withdrawals: rows, total: count, page: parseInt(page, 10),
      totalPages: Math.ceil(count / limit),
      counts: { all, pending, processing, paid, pendingAmount: Number(pendingSum) || 0 },
    });
  } catch (err) { next(err); }
});

router.patch('/withdrawals/:id', async (req, res, next) => {
  try {
    const { status, note, provider, providerTransactionId, providerReference, failureCode } = req.body;
    if (!['processing', 'paid', 'cancelled', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус заявки' });
    }
    const withdrawal = await Withdrawal.findByPk(req.params.id);
    if (!withdrawal) return res.status(404).json({ error: 'Заявка не найдена' });
    const allowedFrom = { processing: 'pending', cancelled: 'pending', paid: 'processing', failed: 'processing' };
    if (withdrawal.status !== allowedFrom[status]) return res.status(409).json({ error: `Недопустимый переход ${withdrawal.status} → ${status}` });
    if (['cancelled', 'failed'].includes(status) && !String(note || '').trim()) return res.status(400).json({ error: 'Укажите причину отказа' });
    if (status === 'paid' && (!String(providerTransactionId || '').trim() || !String(providerReference || '').trim())) {
      return res.status(400).json({ error: 'Для выплаты обязательны transaction ID и банковский reference' });
    }
    const amount = Number(withdrawal.amount) || 0;
    const refund = ['cancelled', 'failed'].includes(status);
    await Withdrawal.sequelize.transaction(async (transaction) => {
      const patch = { status, note: note ? String(note).slice(0, 500) : withdrawal.note, processedBy: req.userId };
      if (status === 'processing') patch.processingAt = new Date();
      if (['paid', 'failed', 'cancelled'].includes(status)) patch.processedAt = new Date();
      if (status === 'paid') {
        patch.provider = String(provider || 'manual').slice(0, 30);
        patch.providerTransactionId = String(providerTransactionId).trim().slice(0, 150);
        patch.providerReference = String(providerReference).trim().slice(0, 150);
      }
      if (status === 'failed') {
        patch.failureCode = String(failureCode || 'manual_failure').slice(0, 80);
        patch.failureMessage = String(note).slice(0, 500);
      }
      const [affected] = await Withdrawal.update(patch, {
        where: { id: withdrawal.id, status: allowedFrom[status] }, transaction,
      });
      if (affected === 0) throw Object.assign(new Error('Заявка уже обработана'), { status: 409 });
      if (refund) {
        const [profileAffected] = await LawyerProfile.update(
          { balance: LawyerProfile.sequelize.literal(`balance + ${amount}`) },
          { where: { userId: withdrawal.lawyerId }, transaction },
        );
        if (profileAffected !== 1) throw new Error('Lawyer profile missing during withdrawal refund');
      }
      await FinancialEvent.create({
        withdrawalId: withdrawal.id, actorUserId: req.userId, source: 'admin',
        type: `withdrawal_${status}`, amount,
        idempotencyKey: `withdrawal_${status}:${withdrawal.id}`,
        metadata: { note: note || null, provider: provider || null, providerReference: providerReference || null },
      }, { transaction });
    });
    try {
      await notifications.createNotification(
        withdrawal.lawyerId, 'withdrawal',
        status === 'paid' ? 'Выплата отправлена' : status === 'processing' ? 'Выплата обрабатывается' : 'Заявка на вывод отклонена',
        status === 'paid' ? `Выплата ${amount.toLocaleString('ru-RU')} сум отправлена.`
          : status === 'processing' ? `Заявка на ${amount.toLocaleString('ru-RU')} сум взята в обработку.`
            : `Заявка на ${amount.toLocaleString('ru-RU')} сум отклонена, сумма возвращена на баланс.${note ? ` Причина: ${note}` : ''}`,
        { withdrawalId: withdrawal.id, status },
      );
    } catch (_error) { /* Notification delivery must not roll back money state. */ }
    const updated = await Withdrawal.findByPk(withdrawal.id);
    return res.json({ success: true, withdrawal: updated, refunded: refund });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'Такой ID банковской операции уже использован' });
    return next(err);
  }
});

router.get('/payments', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;
    const where = {};
    if (['pending', 'paid', 'failed', 'refunded'].includes(status)) where.status = status;
    const [{ count, rows }, all, paidCount, paidSum] = await Promise.all([
      Payment.findAndCountAll({
        where, include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
        order: [['createdAt', 'DESC']], limit: parseInt(limit, 10), offset,
      }),
      Payment.count(),
      Payment.count({ where: { status: 'paid', refundStatus: 'none' } }),
      Payment.sum('amount', { where: { status: 'paid', refundStatus: 'none' } }),
    ]);
    return res.json({
      payments: rows, total: count, page: parseInt(page, 10), totalPages: Math.ceil(count / limit),
      counts: { all, paid: paidCount, paidAmount: Number(paidSum) || 0 },
    });
  } catch (err) { return next(err); }
});

// ─── SUPPORT TICKETS (управление) ───────────────────────────
// GET /admin/support — список обращений
router.get('/support', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    // Раньше отдавались первые 100 без пагинации и фильтра: открытые обращения
    // тонули среди закрытых, а всё после 100-го было недостижимо.
    const where = {};
    if (['open', 'in_progress', 'closed'].includes(status)) where.status = status;

    const [{ count, rows }, all, open, inProgress, closed] = await Promise.all([
      SupportTicket.findAndCountAll({
        where,
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      SupportTicket.count(),
      SupportTicket.count({ where: { status: 'open' } }),
      SupportTicket.count({ where: { status: 'in_progress' } }),
      SupportTicket.count({ where: { status: 'closed' } }),
    ]);

    res.json({
      tickets: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, open, in_progress: inProgress, closed },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/support/:id — сменить статус и/или ответить автору обращения
router.patch('/support/:id', async (req, res, next) => {
  try {
    const { status, response } = req.body;
    if (status !== undefined && !['open', 'in_progress', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }
    if (status === undefined && !(typeof response === 'string' && response.trim())) {
      return res.status(400).json({ error: 'Укажите статус или ответ' });
    }
    const ticket = await SupportTicket.findByPk(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });

    let responded = false;
    if (typeof response === 'string' && response.trim()) {
      ticket.response = response.trim();
      ticket.respondedAt = new Date();
      if (status === undefined) ticket.status = 'closed'; // ответ по умолчанию закрывает тикет
      responded = true;
    }
    if (status !== undefined) ticket.status = status;
    await ticket.save();

    // Уведомляем автора обращения, что поддержка ответила (in-app + web-push)
    if (responded && ticket.userId) {
      const notificationService = require('../services/notificationService');
      notificationService.createNotification(
        ticket.userId,
        'support_reply',
        'Ответ поддержки',
        ticket.response.slice(0, 140),
        { ticketId: ticket.id }
      ).catch(() => {});
    }

    res.json({ success: true, ticket });
  } catch (err) {
    next(err);
  }
});

// ─── REVIEWS (модерация) ────────────────────────────────────
// GET /admin/reviews — все отзывы (с автором и юристом)
router.get('/reviews', async (req, res, next) => {
  try {
    const { visibility, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    // Пагинация вместо жёсткого limit=100: после сотого отзыва модерация была слепа.
    const where = {};
    if (visibility === 'hidden') where.isHidden = true;
    if (visibility === 'visible') where.isHidden = false;

    const [{ count, rows }, all, hidden] = await Promise.all([
      Review.findAndCountAll({
        where,
        include: [
          { model: User, as: 'client', attributes: ['id', 'name'] },
          { model: User, as: 'lawyer', attributes: ['id', 'name'] },
        ],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      Review.count(),
      Review.count({ where: { isHidden: true } }),
    ]);

    res.json({
      reviews: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, hidden, visible: all - hidden },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/reviews/:id — скрыть/показать отзыв (+ пересчёт рейтинга юриста)
router.patch('/reviews/:id', async (req, res, next) => {
  try {
    const review = await Review.findByPk(req.params.id);
    if (!review) return res.status(404).json({ error: 'Отзыв не найден' });
    review.isHidden = Boolean(req.body.isHidden);
    await review.save();
    // Скрытые отзывы не влияют на рейтинг — пересчитываем
    await recomputeLawyerRating(review.lawyerId);
    res.json({ success: true, review });
  } catch (err) {
    next(err);
  }
});

// ─── LAWYER PROMOTION PILOT ─────────────────────────────────

router.get('/promotion-packages', async (req, res, next) => {
  try {
    const { page, limit } = validate(promotionPackageQuerySchema, req.query);
    const { count, rows } = await PromotionPackage.findAndCountAll({
      order: [['displayOrder', 'ASC'], ['durationDays', 'ASC'], ['id', 'ASC']],
      limit,
      offset: (page - 1) * limit,
    });
    return res.json({
      packages: rows.map((row) => serializePackage(row, { admin: true })),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/promotion-packages', promotionMutationLimiter, async (req, res, next) => {
  try {
    const body = validate(promotionPackageSchema, req.body);
    const promotionPackage = await sequelize.transaction(async (transaction) => {
      const row = await PromotionPackage.create({ ...body, isActive: false }, { transaction });
      await promotionAudit({
        key: `promotion_package:${row.id}:create`,
        oldValue: null,
        newValue: promotionSnapshot(row),
        actorId: req.userId,
        transaction,
      });
      return row;
    });
    return res.status(201).json({ package: serializePackage(promotionPackage, { admin: true }) });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

router.put('/promotion-packages/:id', promotionMutationLimiter, async (req, res, next) => {
  try {
    const { id } = validate(promotionIdSchema, req.params);
    const body = validate(promotionPackageUpdateSchema, req.body);
    const promotionPackage = await sequelize.transaction(async (transaction) => {
      const row = await PromotionPackage.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!row) {
        const error = new Error('Пакет продвижения не найден');
        error.status = 404;
        throw error;
      }
      const before = promotionSnapshot(row);
      await row.update(body, { transaction });
      await promotionAudit({
        key: `promotion_package:${row.id}:update`,
        oldValue: before,
        newValue: promotionSnapshot(row),
        actorId: req.userId,
        transaction,
      });
      return row;
    });
    return res.json({ package: serializePackage(promotionPackage, { admin: true }) });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

router.patch('/promotion-packages/:id/activation', promotionMutationLimiter, async (req, res, next) => {
  try {
    const { id } = validate(promotionIdSchema, req.params);
    const body = validate(promotionActivationSchema, req.body);
    const promotionPackage = await sequelize.transaction(async (transaction) => {
      const row = await PromotionPackage.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!row) {
        const error = new Error('Пакет продвижения не найден');
        error.status = 404;
        throw error;
      }
      await row.validate();
      const oldValue = promotionSnapshot(row);
      await row.update({ isActive: body.isActive }, { transaction });
      await promotionAudit({
        key: `promotion_package:${row.id}:activation`,
        oldValue,
        newValue: { ...promotionSnapshot(row), reason: body.reason },
        actorId: req.userId,
        transaction,
      });
      return row;
    });
    return res.json({ package: serializePackage(promotionPackage, { admin: true }) });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

// DELETE is deliberately reversible: packages are retained for campaign snapshots.
router.delete('/promotion-packages/:id', promotionMutationLimiter, async (req, res, next) => {
  try {
    const { id } = validate(promotionIdSchema, req.params);
    const { reason } = validate(promotionReasonSchema, req.body);
    const promotionPackage = await sequelize.transaction(async (transaction) => {
      const row = await PromotionPackage.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!row) {
        const error = new Error('Пакет продвижения не найден');
        error.status = 404;
        throw error;
      }
      const oldValue = promotionSnapshot(row);
      await row.update({ isActive: false }, { transaction });
      await promotionAudit({
        key: `promotion_package:${row.id}:deactivate`,
        oldValue,
        newValue: { ...promotionSnapshot(row), reason },
        actorId: req.userId,
        transaction,
      });
      return row;
    });
    return res.json({ package: serializePackage(promotionPackage, { admin: true }) });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

router.patch('/lawyers/:id/promotion-pilot', promotionMutationLimiter, loadAdminLawyerTarget, async (req, res, next) => {
  try {
    const { id } = validate(promotionIdSchema, req.params);
    const body = validate(promotionPilotSchema, req.body);
    const result = await sequelize.transaction(async (transaction) => {
      const user = await User.findOne({
        where: { id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      const profile = user && await LawyerProfile.findOne({
        where: { userId: id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!user || !profile) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      if (!targetCapabilityAllowed(user, profile)) {
        const error = new Error('Юрист не найден');
        error.status = 404;
        throw error;
      }
      if (body.enabled) {
        const documents = await LawyerDocument.findAll({
          where: { userId: id },
          attributes: ['id', 'type', 'verificationStatus', 'approvedByUserId', 'approvedAt'],
          order: [['id', 'ASC']],
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        const documentCount = documents.length;
        const hasApprovedLicense = documents.some((document) => document.type === 'license'
          && document.verificationStatus === 'approved'
          && document.approvedByUserId
          && document.approvedAt);
        const specializations = Array.isArray(profile.specializations) && profile.specializations.length
          ? profile.specializations : profile.specialization ? [profile.specialization] : [];
        const hasSchedule = profile.schedule && typeof profile.schedule === 'object'
          && Object.values(profile.schedule).some((day) => day?.enabled);
        const complete = String(profile.description || '').trim().length >= 50
          && Number(profile.price) >= 50000 && specializations.length && hasSchedule && documentCount > 0;
        if (!user.isActive || !profile.isAvailable || profile.verificationStatus !== 'approved'
          || !complete || !hasApprovedLicense) {
          const error = new Error('Только активный, одобренный и полностью заполненный профиль можно включить в пилот');
          error.status = 409;
          throw error;
        }
      }
      const previous = Boolean(profile.promotionPilotEnabled);
      await profile.update({ promotionPilotEnabled: body.enabled }, { transaction });
      await promotionAudit({
        key: `promotion_pilot:${id}`,
        oldValue: { enabled: previous },
        newValue: { enabled: body.enabled, reason: body.reason },
        actorId: req.userId,
        transaction,
      });
      return { lawyerId: id, promotionPilotEnabled: body.enabled };
    });
    return res.json(result);
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

router.get('/promotions', async (req, res, next) => {
  try {
    const query = validate(promotionCampaignQuerySchema, req.query);
    const where = {};
    for (const key of ['status', 'lawyerId', 'packageId', 'specialization', 'location']) {
      if (query[key] !== undefined) where[key] = query[key];
    }
    const { count, rows } = await LawyerPromotion.findAndCountAll({
      where,
      include: [
        { model: PromotionPackage, as: 'package' },
        { model: Payment, as: 'payment' },
        { model: User, as: 'lawyer', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
      distinct: true,
    });
    return res.json({
      campaigns: rows.map((row) => serializeCampaign(row, { admin: true })),
      total: count,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(count / query.limit),
    });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

router.post('/promotions/:id/cancel', promotionMutationLimiter, async (req, res, next) => {
  try {
    const { id } = validate(promotionIdSchema, req.params);
    const { reason } = validate(promotionReasonSchema, req.body);
    const result = await sequelize.transaction(async (transaction) => {
      const campaign = await LawyerPromotion.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!campaign) {
        const error = new Error('Продвижение не найдено');
        error.status = 404;
        throw error;
      }
      if (campaign.status !== 'pending_payment') {
        const error = new Error('Для оплаченного продвижения используйте запрос возврата');
        error.status = 409;
        throw error;
      }
      const payment = await Payment.findOne({
        where: { lawyerPromotionId: campaign.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      const now = new Date();
      const existingRequest = payment?.providerData?.cancellationRequest;
      if (existingRequest?.state === 'requested') return { campaign, payment, requested: true };
      const requestMetadata = {
        reason,
        requestedAt: now.toISOString(),
        requestedBy: req.userId,
      };
      let requested = false;
      if (!payment) {
        await campaign.update({ status: 'cancelled', cancelledAt: now, cancellationReason: reason }, { transaction });
      } else if (payment.status === 'pending' && !payment.providerTransactionId && !payment.transactionId) {
        await payment.update({
          status: 'failed',
          cancelledAt: now,
          providerData: {
            ...(payment.providerData || {}),
            cancellationRequest: { ...requestMetadata, state: 'cancelled_locally' },
          },
        }, { transaction });
        await campaign.update({ status: 'cancelled', cancelledAt: now, cancellationReason: reason }, { transaction });
      } else if (['pending', 'processing'].includes(payment.status)) {
        requested = true;
        await payment.update({
          providerData: {
            ...(payment.providerData || {}),
            cancellationRequest: { ...requestMetadata, state: 'requested' },
          },
        }, { transaction });
        await campaign.update({ cancellationRequestedAt: now, cancellationReason: reason }, { transaction });
      } else {
        const error = new Error('Состояние платежа требует запроса возврата');
        error.status = 409;
        throw error;
      }
      await promotionAudit({
        key: `promotion_campaign:${campaign.id}:cancel_request`,
        oldValue: { campaignStatus: 'pending_payment', paymentStatus: payment?.previous('status') || null },
        newValue: { campaignStatus: campaign.status, paymentStatus: payment?.status || null, reason, requested },
        actorId: req.userId,
        transaction,
      });
      return { campaign, payment, requested };
    });
    return res.status(result.requested ? 202 : 200).json({
      promotion: serializeCampaign(result.campaign, { admin: true }),
      payment: serializePayment(result.payment),
      outcome: result.requested ? 'cancellation_requested' : 'cancelled',
    });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

router.post('/promotions/:id/refund', promotionMutationLimiter, async (req, res, next) => {
  try {
    const { id } = validate(promotionIdSchema, req.params);
    const { reason } = validate(promotionReasonSchema, req.body);
    const result = await sequelize.transaction(async (transaction) => {
      const campaign = await LawyerPromotion.findByPk(id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!campaign) {
        const error = new Error('Продвижение не найдено');
        error.status = 404;
        throw error;
      }
      const payment = await Payment.findOne({
        where: { lawyerPromotionId: campaign.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!payment) {
        const error = new Error('Платёж продвижения не найден');
        error.status = 409;
        throw error;
      }
      if (campaign.status === 'refund_pending' && payment.status === 'refund_pending') {
        return { campaign, payment };
      }
      if (!['queued', 'scheduled', 'active', 'paused'].includes(campaign.status) || payment.status !== 'paid') {
        const error = new Error('Возврат доступен только для оплаченного действующего продвижения');
        error.status = 409;
        throw error;
      }
      const now = new Date();
      const amountTiyin = Number(payment.amountTiyin) - earnedPromotionTiyin(campaign, now);
      if (!Number.isSafeInteger(amountTiyin) || amountTiyin <= 0) {
        const error = new Error('У продвижения нет неоказанной суммы для возврата');
        error.status = 409;
        throw error;
      }
      const previousCampaignStatus = campaign.status;
      const frozenClock = {};
      if (campaign.status === 'active' && campaign.activeSince) {
        const totalSeconds = Number(campaign.durationDays) * 24 * 60 * 60;
        const previouslyServed = totalSeconds - Number(campaign.remainingSeconds ?? totalSeconds);
        const activeEnd = campaign.endsAt ? Math.min(now.getTime(), campaign.endsAt.getTime()) : now.getTime();
        const activeServed = Math.max(0, Math.floor((activeEnd - campaign.activeSince.getTime()) / 1000));
        frozenClock.remainingSeconds = Math.max(0, totalSeconds - Math.min(totalSeconds, previouslyServed + activeServed));
        frozenClock.activeSince = null;
        frozenClock.endsAt = null;
      }
      await campaign.update({
        status: 'refund_pending',
        cancellationRequestedAt: now,
        refundRequestedAt: now,
        cancellationReason: reason,
        ...frozenClock,
      }, { transaction });
      await payment.update({
        status: 'refund_pending',
        providerData: {
          ...(payment.providerData || {}),
          promotionRefundRequest: {
            amountTiyin,
            reason,
            requestedAt: now.toISOString(),
            requestedBy: req.userId,
            state: 'requested',
          },
        },
      }, { transaction });
      await promotionAudit({
        key: `promotion_campaign:${campaign.id}:refund_request`,
        oldValue: { campaignStatus: previousCampaignStatus, paymentStatus: 'paid' },
        newValue: { campaignStatus: 'refund_pending', paymentStatus: 'refund_pending', amountTiyin, reason },
        actorId: req.userId,
        transaction,
      });
      return { campaign, payment };
    });
    return res.status(202).json({
      promotion: serializeCampaign(result.campaign, { admin: true }),
      payment: serializePayment(result.payment),
      outcome: 'refund_requested',
    });
  } catch (error) {
    return promotionAdminError(res, next, error);
  }
});

// ─── PROMO CODES (CRUD) ─────────────────────────────────────
// GET /admin/promos — список промокодов
router.get('/promos', async (req, res, next) => {
  try {
    const promos = await Promo.findAll({ order: [['createdAt', 'DESC']] });
    res.json(promos);
  } catch (err) {
    next(err);
  }
});

// POST /admin/promos — создать промокод
router.post('/promos', async (req, res, next) => {
  try {
    const { code, discountPercent, minAmount, usageLimit, expiresAt, isActive } = req.body;
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'Укажите код' });
    const pct = Number(discountPercent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: 'Скидка должна быть от 1 до 100%' });
    }
    // Дата в прошлом молча создавала мёртвый код: promoService всегда отклонял бы его.
    if (expiresAt && new Date(expiresAt) < new Date(new Date().toDateString())) {
      return res.status(400).json({ error: 'Дата окончания не может быть в прошлом' });
    }
    if (minAmount != null && Number(minAmount) < 0) {
      return res.status(400).json({ error: 'Минимальная сумма не может быть отрицательной' });
    }
    if (usageLimit != null && usageLimit !== '' && Number(usageLimit) < 1) {
      return res.status(400).json({ error: 'Лимит использований должен быть не меньше 1' });
    }
    const [promo, created] = await Promo.findOrCreate({
      where: { code: String(code).trim().toUpperCase() },
      defaults: {
        code: String(code).trim().toUpperCase(),
        discountPercent: pct,
        minAmount: Number(minAmount) || 0,
        usageLimit: usageLimit != null && usageLimit !== '' ? Number(usageLimit) : null,
        expiresAt: expiresAt || null,
        isActive: isActive !== false,
      },
    });
    if (!created) return res.status(409).json({ error: 'Такой промокод уже существует' });
    res.status(201).json(promo);
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/promos/:id — изменить (в т.ч. включить/выключить)
router.patch('/promos/:id', async (req, res, next) => {
  try {
    const promo = await Promo.findByPk(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
    const { discountPercent, minAmount, usageLimit, expiresAt, isActive } = req.body;
    if (discountPercent != null) {
      const pct = Number(discountPercent);
      if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
        return res.status(400).json({ error: 'Скидка должна быть от 1 до 100%' });
      }
      promo.discountPercent = pct;
    }
    if (minAmount != null) {
      if (Number(minAmount) < 0) return res.status(400).json({ error: 'Минимальная сумма не может быть отрицательной' });
      promo.minAmount = Number(minAmount) || 0;
    }
    if (usageLimit !== undefined) {
      const lim = usageLimit === '' || usageLimit === null ? null : Number(usageLimit);
      // Лимит ниже уже использованного количества сделал бы код мёртвым «задним числом».
      if (lim != null && lim < (promo.usedCount || 0)) {
        return res.status(400).json({ error: `Лимит нельзя опустить ниже уже использованных (${promo.usedCount})` });
      }
      promo.usageLimit = lim;
    }
    if (expiresAt !== undefined) {
      if (expiresAt && new Date(expiresAt) < new Date(new Date().toDateString())) {
        return res.status(400).json({ error: 'Дата окончания не может быть в прошлом' });
      }
      promo.expiresAt = expiresAt || null;
    }
    if (isActive != null) promo.isActive = Boolean(isActive);
    await promo.save();
    res.json(promo);
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/promos/:id — удалить
router.delete('/promos/:id', async (req, res, next) => {
  try {
    const promo = await Promo.findByPk(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
    await promo.destroy();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

return router;
}

module.exports = createAdminPortalRouter;

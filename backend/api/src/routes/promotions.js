const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const { PromotionPackage, LawyerPromotion, Payment } = require('../models');
const { authenticate, authorizeCompat } = require('../middleware/auth');
const { createPromotionCheckout } = require('../services/promotionService');

const lawyerAccess = authorizeCompat({ legacyRoles: ['lawyer'], capability: 'lawyer', telemetryName: 'http.lawyer' });

const uuid = Joi.string().guid({ version: ['uuidv4'] });
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);
const checkoutSchema = Joi.object({
  packageId: uuid.required(),
  specialization: Joi.string().trim().min(1).max(120).required(),
  location: Joi.string().trim().min(1).max(120).allow(null).optional(),
});
const idSchema = Joi.object({ id: uuid.required() }).unknown(false);

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток оформления продвижения' },
});

function validate(schema, input, options = {}) {
  const result = schema.validate(input, {
    abortEarly: false,
    convert: true,
    stripUnknown: Boolean(options.stripUnknown),
  });
  if (result.error) {
    const error = new Error(result.error.details.map((detail) => detail.message).join('; '));
    error.status = 400;
    throw error;
  }
  return result.value;
}

function serializePackage(row, { admin = false } = {}) {
  if (!row) return null;
  const result = {
    id: row.id,
    code: row.code,
    name: row.name,
    placement: row.placement,
    durationDays: Number(row.durationDays),
    priceAmountTiyin: Number(row.priceAmountTiyin),
    currency: row.currency,
    maxActiveSlots: Number(row.maxActiveSlots),
    sponsoredPositions: row.sponsoredPositions,
    displayOrder: Number(row.displayOrder),
  };
  if (admin) result.isActive = Boolean(row.isActive);
  return result;
}

function serializePayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    amount: Number(row.amount),
    amountTiyin: Number(row.amountTiyin),
    currency: row.currency,
    paidAt: row.paidAt,
    cancelledAt: row.cancelledAt,
    refundedAt: row.refundedAt,
    refundedAmountTiyin: Number(row.refundedAmountTiyin || 0),
  };
}

function serializeCampaign(row, { admin = false } = {}) {
  const result = {
    id: row.id,
    packageId: row.packageId,
    package: serializePackage(row.package, { admin }),
    placement: row.placement,
    specialization: row.specialization,
    location: row.location,
    durationDays: Number(row.durationDays),
    priceAmountTiyin: Number(row.priceAmountTiyin),
    currency: row.currency,
    sponsoredPositions: row.sponsoredPositions,
    status: row.status,
    reservationExpiresAt: row.reservationExpiresAt,
    paidAt: row.paidAt,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    pausedAt: row.pausedAt,
    resumeDeadline: row.resumeDeadline,
    cancellationRequestedAt: row.cancellationRequestedAt,
    cancelledAt: row.cancelledAt,
    refundRequestedAt: row.refundRequestedAt,
    refundedAt: row.refundedAt,
    impressions: Number(row.impressions),
    profileViews: Number(row.profileViews),
    bookingStarts: Number(row.bookingStarts),
    bookings: Number(row.bookings),
    createdAt: row.createdAt,
    payment: serializePayment(row.payment),
  };
  if (admin) result.lawyer = row.lawyer ? { id: row.lawyer.id, name: row.lawyer.name } : null;
  return result;
}

function sendRouteError(res, next, error) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (/not active/i.test(error.message)) return res.status(409).json({ error: error.message });
  if (/idempotency|active checkout/i.test(error.message)) return res.status(409).json({ error: error.message });
  return next(error);
}

router.get('/promotion-packages', async (req, res, next) => {
  try {
    const packages = await PromotionPackage.findAll({
      where: { isActive: true },
      order: [['displayOrder', 'ASC'], ['durationDays', 'ASC'], ['id', 'ASC']],
    });
    return res.json({ packages: packages.map((row) => serializePackage(row)) });
  } catch (error) {
    return next(error);
  }
});

router.post('/lawyer/promotions/checkout', authenticate, lawyerAccess, checkoutLimiter, async (req, res, next) => {
  try {
    const body = validate(checkoutSchema, req.body, { stripUnknown: true });
    const idempotencyKey = validate(
      Joi.string().trim().min(1).max(255).pattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).required(),
      req.get('Idempotency-Key')
    );
    const { reservation, checkout } = await createPromotionCheckout({
      lawyerId: req.userId,
      packageId: body.packageId,
      specialization: body.specialization,
      location: body.location,
      idempotencyKey,
    });
    const promotion = await LawyerPromotion.findByPk(reservation.promotion.id, {
      include: [
        { model: PromotionPackage, as: 'package' },
        { model: Payment, as: 'payment' },
      ],
    });
    return res.status(reservation.created ? 201 : 200).json({
      promotion: serializeCampaign(promotion),
      outcome: reservation.outcome,
      paymentId: checkout.paymentId,
      paymentStatus: checkout.payment.status,
      checkoutUrl: checkout.checkoutUrl,
      amount: checkout.amount,
      amountTiyin: checkout.amountTiyin,
      currency: checkout.payment.currency,
    });
  } catch (error) {
    return sendRouteError(res, next, error);
  }
});

router.get('/lawyer/promotions', authenticate, lawyerAccess, async (req, res, next) => {
  try {
    const { page, limit } = validate(paginationSchema, req.query);
    const { count, rows } = await LawyerPromotion.findAndCountAll({
      where: { lawyerId: req.userId },
      include: [
        { model: PromotionPackage, as: 'package' },
        { model: Payment, as: 'payment' },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });
    return res.json({
      promotions: rows.map((row) => serializeCampaign(row)),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    return sendRouteError(res, next, error);
  }
});

router.get('/lawyer/promotions/:id', authenticate, lawyerAccess, async (req, res, next) => {
  try {
    const { id } = validate(idSchema, req.params);
    const promotion = await LawyerPromotion.findOne({
      where: { id, lawyerId: req.userId },
      include: [
        { model: PromotionPackage, as: 'package' },
        { model: Payment, as: 'payment' },
      ],
    });
    if (!promotion) return res.status(404).json({ error: 'Продвижение не найдено' });
    return res.json({ promotion: serializeCampaign(promotion), payment: serializePayment(promotion.payment) });
  } catch (error) {
    return sendRouteError(res, next, error);
  }
});

module.exports = {
  router,
  serializePackage,
  serializePayment,
  serializeCampaign,
  validate,
};

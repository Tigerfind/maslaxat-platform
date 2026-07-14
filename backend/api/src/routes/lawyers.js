const router = require('express').Router();
const { Op } = require('sequelize');
const { User, LawyerProfile, Review, Consultation } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notifications = require('../services/notificationService');

// GET /api/lawyers — поиск юристов (публичный)
router.get('/', async (req, res, next) => {
  try {
    const { specialization, search, minRating, sortBy, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const profileWhere = {};
    if (specialization) profileWhere.specialization = specialization;
    if (minRating) profileWhere.rating = { [Op.gte]: parseFloat(minRating) };

    const userWhere = { role: 'lawyer', isActive: true };
    if (search) {
      userWhere.name = { [Op.iLike]: `%${search}%` };
    }

    let order = [['createdAt', 'DESC']];
    if (sortBy === 'rating') order = [[{ model: LawyerProfile, as: 'profile' }, 'rating', 'DESC']];
    if (sortBy === 'price_low') order = [[{ model: LawyerProfile, as: 'profile' }, 'price', 'ASC']];
    if (sortBy === 'price_high') order = [[{ model: LawyerProfile, as: 'profile' }, 'price', 'DESC']];
    if (sortBy === 'experience') order = [[{ model: LawyerProfile, as: 'profile' }, 'experience', 'DESC']];

    // Never expose phone/email of lawyers to public/client searches
    const { count, rows } = await User.findAndCountAll({
      where: userWhere,
      attributes: ['id', 'name', 'avatar', 'role', 'isVerified', 'createdAt'],
      include: [{
        model: LawyerProfile,
        as: 'profile',
        where: profileWhere,
        required: true,
      }],
      order,
      limit: parseInt(limit),
      offset,
    });

    res.json({
      lawyers: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/lawyers/:id — профиль юриста
router.get('/:id', async (req, res, next) => {
  try {
    // Never expose phone/email to public profile viewers
    const lawyer = await User.findOne({
      where: { id: req.params.id, role: 'lawyer' },
      attributes: ['id', 'name', 'avatar', 'role', 'isVerified', 'createdAt'],
      include: [
        { model: LawyerProfile, as: 'profile' },
        {
          model: Review,
          as: 'receivedReviews',
          include: [{ model: User, as: 'client', attributes: ['id', 'name', 'avatar'] }],
          order: [['createdAt', 'DESC']],
          limit: 20,
        },
      ],
    });

    if (!lawyer) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    res.json({ lawyer });
  } catch (err) {
    next(err);
  }
});

// POST /api/lawyers/:id/book — бронирование консультации
router.post('/:id/book', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const lawyer = await User.findOne({
      where: { id: req.params.id, role: 'lawyer' },
      include: [{ model: LawyerProfile, as: 'profile' }],
    });

    if (!lawyer) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    const consultation = await Consultation.create({
      clientId: req.userId,
      lawyerId: lawyer.id,
      type: req.body.consultationType || 'video',
      question: req.body.question,
      description: req.body.description,
      preferredDate: req.body.preferredDate,
      preferredTime: req.body.preferredTime,
      price: lawyer.profile.price,
      status: 'pending',
    });

    // Notify the lawyer about the new booking
    const client = await User.findByPk(req.userId, { attributes: ['name'] });
    notifications.notifyNewBooking(lawyer.id, client?.name || 'Клиент', consultation);

    res.status(201).json({
      success: true,
      message: 'Запрос отправлен юристу',
      consultation,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lawyers/:id/review — оставить отзыв
router.post('/:id/review', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const review = await Review.create({
      clientId: req.userId,
      lawyerId: req.params.id,
      consultationId: req.body.consultationId,
      rating: req.body.rating,
      text: req.body.text,
    });

    // Update lawyer rating
    const allReviews = await Review.findAll({ where: { lawyerId: req.params.id } });
    const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

    await LawyerProfile.update(
      { rating: Math.round(avgRating * 10) / 10, reviewsCount: allReviews.length },
      { where: { userId: req.params.id } }
    );

    // Notify the lawyer about the new review
    const reviewer = await User.findByPk(req.userId, { attributes: ['name'] });
    notifications.notifyNewReview(req.params.id, reviewer?.name || 'Клиент', req.body.rating);

    res.status(201).json({ review });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

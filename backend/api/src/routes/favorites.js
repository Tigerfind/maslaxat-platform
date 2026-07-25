const express = require('express');
const router = express.Router();
const { User, FavoriteLawyer, LawyerProfile } = require('../models');
const { authenticate } = require('../middleware/auth');

// @route   POST /api/favorites/:lawyerId
// @desc    Add lawyer to favorites
// @access  Private (Client)
router.post('/:lawyerId', authenticate, async (req, res, next) => {
  try {
    const { lawyerId } = req.params;
    const clientId = req.userId;

    // Check if lawyer exists
    const lawyer = await User.findByPk(lawyerId);
    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(404).json({ message: 'Lawyer not found' });
    }

    // Check if already favorited
    const existing = await FavoriteLawyer.findOne({
      where: { clientId, lawyerId },
    });

    if (existing) {
      return res.status(400).json({ message: 'Already in favorites' });
    }

    // Add to favorites
    await FavoriteLawyer.create({ clientId, lawyerId });

    res.status(201).json({ message: 'Added to favorites' });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/favorites/:lawyerId
// @desc    Remove lawyer from favorites
// @access  Private (Client)
router.delete('/:lawyerId', authenticate, async (req, res, next) => {
  try {
    const { lawyerId } = req.params;
    const clientId = req.userId;

    const favorite = await FavoriteLawyer.findOne({
      where: { clientId, lawyerId },
    });

    if (!favorite) {
      return res.status(404).json({ message: 'Not in favorites' });
    }

    await favorite.destroy();

    res.json({ message: 'Removed from favorites' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/favorites
// @desc    Get all favorite lawyers for current client
// @access  Private (Client)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const clientId = req.userId;

    const favorites = await FavoriteLawyer.findAll({
      where: { clientId },
      include: [
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'email', 'avatar'],
          include: [
            {
              model: LawyerProfile,
              as: 'profile',
            },
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const lawyers = favorites.map((fav) => ({
      id: fav.lawyer.id,
      name: fav.lawyer.name,
      avatar: fav.lawyer.avatar,
      specialization: fav.lawyer.profile?.specialization,
      rating: fav.lawyer.profile?.rating || 0,
      reviewsCount: fav.lawyer.profile?.reviewsCount || 0,
      experience: fav.lawyer.profile?.experience || 0,
      priceFrom: fav.lawyer.profile?.price || 0,
      location: fav.lawyer.profile?.location,
      isAvailable: fav.lawyer.profile?.isAvailable,
      completedConsultations: fav.lawyer.profile?.completedCases || 0,
      addedAt: fav.createdAt,
    }));

    res.json(lawyers);
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/favorites/check/:lawyerId
// @desc    Check if lawyer is favorited
// @access  Private (Client)
router.get('/check/:lawyerId', authenticate, async (req, res, next) => {
  try {
    const { lawyerId } = req.params;
    const clientId = req.userId;

    const favorite = await FavoriteLawyer.findOne({
      where: { clientId, lawyerId },
    });

    res.json({ isFavorite: !!favorite });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

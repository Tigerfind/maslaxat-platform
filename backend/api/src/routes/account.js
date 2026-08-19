const router = require('express').Router();
const { sequelize, User, LawyerProfile } = require('../models');
const { authenticate } = require('../middleware/auth');

router.post('/lawyer-profile', authenticate, async (req, res, next) => {
  try {
    const result = await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(req.userId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!user || user.accountType === 'admin') return { forbidden: true };

      let profile = await LawyerProfile.findOne({ where: { userId: user.id }, transaction });
      const created = !profile;
      if (!profile) {
        profile = await LawyerProfile.create({
          userId: user.id,
          specialization: null,
          specializations: [],
          verificationStatus: 'pending',
          operatingStatus: 'suspended',
          isAvailable: false,
        }, { transaction });
      }

      if (user.role !== 'lawyer' || user.preferredMode !== 'lawyer') {
        await user.update({ role: 'lawyer', preferredMode: 'lawyer' }, { transaction });
      }
      return { profile, created };
    });

    if (result.forbidden) return res.status(403).json({ error: 'Администратор не может создать профиль юриста' });
    return res.status(result.created ? 201 : 200).json({ profile: result.profile.toJSON() });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { User, LawyerProfile, sequelize } = require('../models');
const twoFactor = require('../services/twoFactorService');

// Applicant/admin bootstrap is based on current account state, not legacy role.
function is2FAAvailable(req) {
  return req.user.accountType === 'admin'
    || (req.user.accountType === 'member' && !!req.userProfile);
}

function require2FAEligible(req, res, next) {
  if (!is2FAAvailable(req)) {
    return res.status(403).json({ error: '2FA доступна только юристам и администраторам' });
  }
  next();
}

// GET /api/2fa/status — включена ли 2FA у текущего пользователя
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, { attributes: ['id', 'twoFactorEnabled'] });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ enabled: !!user.twoFactorEnabled, available: is2FAAvailable(req) });
  } catch (err) {
    next(err);
  }
});

// POST /api/2fa/setup — сгенерировать секрет и вернуть QR (ещё НЕ включает 2FA)
router.post('/setup', authenticate, require2FAEligible, async (req, res, next) => {
  try {
    const setup = await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) return { error: [404, 'Пользователь не найден'] };
      if (user.twoFactorEnabled) return { error: [400, '2FA уже включена'] };

      const secret = twoFactor.generateSecret();
      user.twoFactorSecret = secret;
      user.twoFactorVersion += 1;
      await user.save({ transaction });
      return { email: user.email, secret };
    });
    if (setup.error) return res.status(setup.error[0]).json({ error: setup.error[1] });

    const { otpauthUrl, qrDataUrl } = await twoFactor.buildOtpAuth(setup.email, setup.secret);
    const { secret } = setup;
    res.json({ secret, otpauthUrl, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/2fa/enable — подтвердить кодом и включить 2FA; вернуть резервные коды (один раз)
router.post('/enable', authenticate, require2FAEligible, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const result = await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) return { error: [404, 'Пользователь не найден'] };
      if (user.twoFactorEnabled) return { error: [400, '2FA уже включена'] };
      if (!user.twoFactorSecret) return { error: [400, 'Сначала выполните настройку'] };
      if (!twoFactor.verifyToken(user.twoFactorSecret, token)) return { error: [400, 'Неверный код'] };

      const { plain, hashes } = twoFactor.generateBackupCodes();
      user.twoFactorEnabled = true;
      user.twoFactorBackupCodes = hashes;
      user.twoFactorVersion += 1;
      await user.save({ transaction });
      return { backupCodes: plain };
    });
    if (result.error) return res.status(result.error[0]).json({ error: result.error[1] });

    res.json({ success: true, backupCodes: result.backupCodes });
  } catch (err) {
    next(err);
  }
});

// POST /api/2fa/disable — выключить 2FA (нужен действующий код или резервный код)
router.post('/disable', authenticate, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const result = await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) return { error: [404, 'Пользователь не найден'] };
      if (!user.twoFactorEnabled) return { error: [400, '2FA не включена'] };

      const okTotp = twoFactor.verifyToken(user.twoFactorSecret, token);
      const remaining = twoFactor.consumeBackupCode(user.twoFactorBackupCodes, token);
      if (!okTotp && !remaining) return { error: [400, 'Неверный код'] };

      user.twoFactorEnabled = false;
      user.twoFactorSecret = null;
      user.twoFactorBackupCodes = [];
      user.twoFactorVersion += 1;
      await user.save({ transaction });
      await LawyerProfile.update(
        { operatingStatus: 'suspended', isAvailable: false },
        { where: { userId: user.id }, transaction }
      );
      return { success: true };
    });
    if (result.error) return res.status(result.error[0]).json({ error: result.error[1] });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

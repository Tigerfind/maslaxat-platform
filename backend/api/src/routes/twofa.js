const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');
const { User } = require('../models');
const twoFactor = require('../services/twoFactorService');
const { disconnectUserSockets } = require('../socket/io');

function rotateAccessToken(user) {
  user.passwordChangedAt = new Date();
  const token = jwt.sign(
    { id: user.id, role: user.role, sv: user.passwordChangedAt.getTime() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
  return token;
}

// 2FA доступна юристам и админам
function require2FARole(req, res, next) {
  if (req.userRole !== 'lawyer' && req.userRole !== 'admin') {
    return res.status(403).json({ error: '2FA доступна только юристам и администраторам' });
  }
  next();
}

// GET /api/2fa/status — включена ли 2FA у текущего пользователя
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, { attributes: ['id', 'twoFactorEnabled', 'role'] });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ enabled: !!user.twoFactorEnabled, available: user.role === 'lawyer' || user.role === 'admin' });
  } catch (err) {
    next(err);
  }
});

// POST /api/2fa/setup — сгенерировать секрет и вернуть QR (ещё НЕ включает 2FA)
router.post('/setup', authenticate, require2FARole, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.twoFactorEnabled) return res.status(400).json({ error: '2FA уже включена' });

    const secret = twoFactor.generateSecret();
    user.twoFactorSecret = secret; // сохраняем ожидающий секрет, enabled пока false
    await user.save();

    const { otpauthUrl, qrDataUrl } = await twoFactor.buildOtpAuth(user.email, secret);
    res.json({ secret, otpauthUrl, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/2fa/enable — подтвердить кодом и включить 2FA; вернуть резервные коды (один раз)
router.post('/enable', authenticate, require2FARole, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const user = await User.findByPk(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.twoFactorEnabled) return res.status(400).json({ error: '2FA уже включена' });
    if (!user.twoFactorSecret) return res.status(400).json({ error: 'Сначала выполните настройку' });

    if (!twoFactor.verifyToken(user.twoFactorSecret, token)) {
      return res.status(400).json({ error: 'Неверный код' });
    }

    const { plain, hashes } = twoFactor.generateBackupCodes();
    user.twoFactorEnabled = true;
    user.twoFactorBackupCodes = hashes;
    const accessToken = rotateAccessToken(user);
    await user.save();
    disconnectUserSockets(user.id);

    res.json({ success: true, backupCodes: plain, token: accessToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/2fa/disable — выключить 2FA (нужен действующий код или резервный код)
router.post('/disable', authenticate, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    const user = await User.findByPk(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (!user.twoFactorEnabled) return res.status(400).json({ error: '2FA не включена' });

    const okTotp = twoFactor.verifyToken(user.twoFactorSecret, token);
    const remaining = twoFactor.consumeBackupCode(user.twoFactorBackupCodes, token);
    if (!okTotp && !remaining) {
      return res.status(400).json({ error: 'Неверный код' });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.twoFactorBackupCodes = [];
    const accessToken = rotateAccessToken(user);
    await user.save();
    disconnectUserSockets(user.id);

    res.json({ success: true, token: accessToken });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

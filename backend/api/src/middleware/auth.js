const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Токен не предоставлен' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Промежуточный токен-вызов 2FA (twofa:'pending') НЕ является полноценным
    // токеном доступа — с ним нельзя ходить по защищённым роутам, только пройти
    // второй шаг входа (/auth/login/2fa). Иначе 2FA полностью обходится.
    if (decoded.twofa) {
      return res.status(401).json({ error: 'Требуется подтверждение 2FA' });
    }

    const user = await User.findByPk(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    // Токен, выданный ДО последней смены пароля (сброс при компрометации),
    // считается недействительным — старые сессии выкидываются.
    if (user.passwordChangedAt && decoded.iat) {
      if (decoded.iat * 1000 < new Date(user.passwordChangedAt).getTime()) {
        return res.status(401).json({ error: 'Сессия недействительна, войдите заново' });
      }
    }

    req.user = user;
    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Токен истёк' });
    }
    return res.status(401).json({ error: 'Невалидный токен' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
};

module.exports = { authenticate, authorize };

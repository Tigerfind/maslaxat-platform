const { Op } = require('sequelize');
const { Consultation, User } = require('../models');
const { notifyConsultationReminder } = require('./notificationService');
const { sendMail } = require('./emailService');
const logger = require('../config/logger');

const WINDOW_MIN = 60; // напоминаем, когда до старта ≤ 60 минут

// Собирает дату+время консультации в объект Date. Возвращает null, если данных нет.
function startDateTime(consultation) {
  if (!consultation.preferredDate || !consultation.preferredTime) return null;
  // preferredDate: 'YYYY-MM-DD', preferredTime: 'HH:mm'
  const iso = `${consultation.preferredDate}T${String(consultation.preferredTime).slice(0, 5)}:00`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : dt;
}

async function sendReminderEmail(user, partnerName, consultation) {
  if (!user?.email) return;
  try {
    await sendMail({
      to: user.email,
      subject: 'Напоминание: скоро консультация — MaslaXat',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#2D2D2D">
          <h2 style="color:#8B7355">Скоро консультация</h2>
          <p>Здравствуйте, ${user.name || ''}!</p>
          <p>Напоминаем: ваша ${consultation.type === 'video' ? 'видео' : 'чат'}-консультация
          с <b>${partnerName}</b> начнётся примерно через час — сегодня в
          <b>${consultation.preferredTime}</b>.</p>
          <p>Пожалуйста, будьте готовы вовремя.</p>
          <p style="color:#8a7a66;font-size:13px">— Команда MaslaXat</p>
        </div>`,
    });
  } catch (err) {
    logger.error('[Reminder] email failed', { error: err.message });
  }
}

// Основная проверка: находит консультации в ближайший час без отправленного напоминания.
async function checkUpcomingReminders() {
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + WINDOW_MIN * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    // Кандидаты: подтверждённые/ожидающие, ещё не напомненные, на сегодня
    const candidates = await Consultation.findAll({
      where: {
        status: { [Op.in]: ['accepted', 'pending'] },
        reminderSent: false,
        preferredDate: today,
      },
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name', 'email'] },
      ],
    });

    let sent = 0;
    for (const c of candidates) {
      const start = startDateTime(c);
      if (!start) continue;
      // Только если старт в пределах ближайшего часа и ещё не прошёл
      if (start <= now || start > horizon) continue;

      const lawyerName = c.lawyer?.name || 'юристом';
      const clientName = c.client?.name || 'клиентом';

      // Уведомление + email обоим участникам
      if (c.clientId) {
        await notifyConsultationReminder(c.clientId, lawyerName, c);
        await sendReminderEmail(c.client, lawyerName, c);
      }
      if (c.lawyerId) {
        await notifyConsultationReminder(c.lawyerId, clientName, c);
        await sendReminderEmail(c.lawyer, clientName, c);
      }

      c.reminderSent = true;
      await c.save();
      sent++;
    }

    if (sent > 0) logger.info(`[Reminder] Sent reminders for ${sent} consultation(s)`);
    return sent;
  } catch (err) {
    logger.error('[Reminder] check failed', { error: err.message });
    return 0;
  }
}

// Запускает периодическую проверку (каждые 5 минут)
function startReminderJob() {
  const INTERVAL = 5 * 60 * 1000;
  setInterval(checkUpcomingReminders, INTERVAL);
  // Первый прогон вскоре после старта сервера
  setTimeout(checkUpcomingReminders, 15 * 1000);
  logger.info('[Reminder] Job started (every 5 min)');
}

module.exports = { checkUpcomingReminders, startReminderJob };

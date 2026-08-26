const { Op } = require('sequelize');
const { Consultation, User } = require('../models');
const { createNotification } = require('./notificationService');
const { sendMail } = require('./emailService');
const logger = require('../config/logger');

const WINDOWS = [
  { minutes: 24 * 60, lowerMinutes: 60, field: 'reminder24Sent', label: '24 часа' },
  { minutes: 60, lowerMinutes: 10, field: 'reminderSent', label: '1 час' },
  { minutes: 10, lowerMinutes: 0, field: 'reminder10Sent', label: '10 минут' },
];

async function sendReminder(user, partnerName, consultation, label) {
  if (!user) return;
  const timezone = consultation.scheduleTimezone || 'Asia/Tashkent';
  const displayedStart = new Date(consultation.scheduledStartAt).toLocaleString('ru-RU', {
    timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  await createNotification(user.id, 'consultation_reminder', `Консультация через ${label}`, `Консультация с ${partnerName}: ${displayedStart} (${timezone})`, { consultationId: consultation.id, startsAt: consultation.scheduledStartAt });
  if (user.email) await sendMail({
    to: user.email, subject: `Напоминание: консультация через ${label} — MaslaXat`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#2D2D2D"><h2>Скоро консультация</h2><p>Консультация с <b>${partnerName}</b> начнётся через ${label}: <b>${displayedStart} (${timezone})</b>.</p><p>Ссылка доступна только после входа в кабинет.</p></div>`,
  });
}

async function processWindow(window, now) {
  const target = new Date(now.getTime() + window.minutes * 60000);
  const tolerance = window.minutes === 10 ? 2 : 6;
  const candidates = await Consultation.findAll({
    where: {
      status: { [Op.in]: ['accepted', 'pending'] }, [window.field]: false,
      scheduledStartAt: { [Op.gt]: new Date(now.getTime() + window.lowerMinutes * 60000), [Op.lte]: new Date(target.getTime() + tolerance * 60000) },
    },
    include: [{ model: User, as: 'client', attributes: ['id', 'name', 'email'] }, { model: User, as: 'lawyer', attributes: ['id', 'name', 'email'] }],
  });
  let sent = 0;
  for (const consultation of candidates) {
    const [claimed] = await Consultation.update({ [window.field]: true }, { where: {
      id: consultation.id, [window.field]: false, status: { [Op.in]: ['accepted', 'pending'] },
      scheduledStartAt: consultation.scheduledStartAt,
    } });
    if (!claimed) continue;
    try {
      await Promise.allSettled([
        sendReminder(consultation.client, consultation.lawyer?.name || 'юристом', consultation, window.label),
        sendReminder(consultation.lawyer, consultation.client?.name || 'клиентом', consultation, window.label),
      ]);
      sent += 1;
    } catch (error) { logger.error('[Reminder] item failed', { consultationId: consultation.id, code: error.code, message: error.message }); }
  }
  return sent;
}

async function checkUpcomingReminders() {
  const now = new Date();
  const results = await Promise.all(WINDOWS.map((window) => processWindow(window, now).catch((error) => {
    logger.error('[Reminder] check failed', { window: window.minutes, code: error.code, message: error.message }); return 0;
  })));
  return results.reduce((sum, value) => sum + value, 0);
}

function startReminderJob() {
  const timer = setInterval(checkUpcomingReminders, 5 * 60 * 1000); timer.unref?.();
  setTimeout(checkUpcomingReminders, 15000).unref?.();
  logger.info('[Reminder] Job started', { windows: WINDOWS.map((item) => item.minutes) });
}

module.exports = { WINDOWS, checkUpcomingReminders, startReminderJob };

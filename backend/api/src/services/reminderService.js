const { Op } = require('sequelize');
const { Consultation, User } = require('../models');
const { notifyConsultationReminder } = require('./notificationService');
const { sendMail } = require('./emailService');
const logger = require('../config/logger');
const { reportCaughtException } = require('../instrument');

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
    reportCaughtException(err, {
      operation: 'reminder_email',
      consultationId: consultation.id,
      userId: user.id,
    });
    logger.error('reminder_email_failed', { consultationId: consultation.id, userId: user.id });
  }
}

// Основная проверка: находит консультации в ближайший час без отправленного напоминания.
function abortIfRequested(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Reminder job aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
}

async function checkUpcomingReminders(nowValue = new Date(), { signal } = {}) {
  try {
    abortIfRequested(signal);
    const now = new Date(nowValue);
    const horizon = new Date(now.getTime() + WINDOW_MIN * 60 * 1000);
    // ЛОКАЛЬНАЯ дата (preferredDate + preferredTime трактуются как локальное время сервера).
    // Раньше здесь была UTC-дата → рассинхрон у сервера не в UTC и промахи около полуночи.
    const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = localDate(now);
    const tomorrow = localDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    // Кандидаты: подтверждённые/ожидающие, ещё не напомненные, на сегодня/завтра
    // (завтра — чтобы поймать окно, пересекающее полночь). Точное окно — по времени ниже.
    const candidates = await Consultation.findAll({
      where: {
        status: { [Op.in]: ['accepted', 'pending'] },
        reminderSent: false,
        preferredDate: { [Op.in]: [today, tomorrow] },
      },
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name', 'email'] },
      ],
    });

    let sent = 0;
    for (const c of candidates) {
      abortIfRequested(signal);
      // Сбой на одной консультации не должен прерывать всю пачку
      try {
        const start = startDateTime(c);
        if (!start) continue;
        // Только если старт в пределах ближайшего часа и ещё не прошёл
        if (start <= now || start > horizon) continue;

        // Помечаем ОТПРАВЛЕННЫМ до рассылки: если письмо/уведомление упадёт
        // после этого, следующий прогон не задублирует напоминание. Атомарно —
        // чтобы параллельные прогоны не отправили дважды.
        const [claimed] = await Consultation.update(
          { reminderSent: true },
          { where: { id: c.id, reminderSent: false } }
        );
        if (claimed === 0) continue; // уже занято другим прогоном

        const lawyerName = c.lawyer?.name || 'юристом';
        const clientName = c.client?.name || 'клиентом';

        if (c.clientId) {
          await notifyConsultationReminder(c.clientId, lawyerName, c);
          await sendReminderEmail(c.client, lawyerName, c);
        }
        if (c.lawyerId) {
          await notifyConsultationReminder(c.lawyerId, clientName, c);
          await sendReminderEmail(c.lawyer, clientName, c);
        }
        sent++;
      } catch (itemErr) {
        reportCaughtException(itemErr, { operation: 'reminder_item', consultationId: c.id });
        logger.error('reminder_item_failed', { consultationId: c.id });
      }
    }

    if (sent > 0) logger.info(`[Reminder] Sent reminders for ${sent} consultation(s)`);
    return sent;
  } catch (err) {
    if (err?.code === 'ABORT_ERR') throw err;
    reportCaughtException(err, { operation: 'reminder_check' });
    logger.error('reminder_check_failed');
    return 0;
  }
}

async function runReminderOnce(now = new Date(), { signal } = {}) {
  abortIfRequested(signal);
  return checkUpcomingReminders(now, { signal });
}

// Запускает периодическую проверку (каждые 5 минут)
function startReminderJob() {
  const INTERVAL = 5 * 60 * 1000;
  setInterval(checkUpcomingReminders, INTERVAL);
  // Первый прогон вскоре после старта сервера
  setTimeout(checkUpcomingReminders, 15 * 1000);
  logger.info('[Reminder] Job started (every 5 min)');
}

module.exports = { checkUpcomingReminders, runReminderOnce, startReminderJob };

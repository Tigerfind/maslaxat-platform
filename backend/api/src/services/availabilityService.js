const { DateTime, IANAZone } = require('luxon');
const { Op } = require('sequelize');
const { sequelize, Consultation, LawyerProfile, User } = require('../models');

const DURATIONS = [30, 60, 90];
const BLOCKING_STATUSES = ['payment_pending', 'pending', 'accepted', 'in_progress'];
const PAYMENT_RESERVATION_MINUTES = 15;
const MIN_LEAD_MINUTES = 120;
const SLOT_STEP_MINUTES = 30;
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function slotError(code, message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

function validateWindow(profile, date, time, duration, now = DateTime.utc()) {
  if (!IANAZone.isValidZone(profile.timezone || 'Asia/Tashkent')) throw slotError('INVALID_TIMEZONE', 'Некорректный часовой пояс юриста');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) {
    throw slotError('INVALID_SLOT', 'Укажите дату и время консультации');
  }
  const minutes = Number(duration);
  if (!DURATIONS.includes(minutes)) throw slotError('INVALID_DURATION', 'Допустимая длительность: 30, 60 или 90 минут');
  if (profile.consultationDurations?.length && !profile.consultationDurations.includes(minutes)) {
    throw slotError('INVALID_DURATION', 'Юрист не проводит консультации выбранной длительности');
  }
  const timezone = profile.timezone || 'Asia/Tashkent';
  const start = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  if (!start.isValid) throw slotError('INVALID_SLOT', 'Некорректная дата консультации');
  const end = start.plus({ minutes });
  if (start.toUTC() < now.plus({ minutes: MIN_LEAD_MINUTES })) {
    throw slotError('MIN_LEAD_TIME', `Консультацию нужно бронировать минимум за ${MIN_LEAD_MINUTES} минут`, 400, { minLeadMinutes: MIN_LEAD_MINUTES });
  }
  if (start.minute % SLOT_STEP_MINUTES !== 0) throw slotError('INVALID_SLOT', 'Время должно быть кратно 30 минутам');
  const day = profile.schedule?.[DAY_KEYS[start.weekday - 1]];
  if (!day?.enabled) throw slotError('INVALID_SLOT', 'В этот день юрист не принимает');
  const open = DateTime.fromISO(`${date}T${day.from}`, { zone: timezone });
  const close = DateTime.fromISO(`${date}T${day.to}`, { zone: timezone });
  if (!open.isValid || !close.isValid || start < open || end > close) throw slotError('INVALID_SLOT', 'Выбранное время не входит в расписание юриста');
  return { start: start.toUTC(), end: end.toUTC(), timezone, duration: minutes };
}

async function lockLawyer(lawyerId, transaction) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', {
    replacements: { key: `lawyer-booking:${lawyerId}` },
    transaction,
  });
}

async function lockBookingParticipants(lawyerId, clientId, transaction) {
  const keys = [`lawyer-booking:${lawyerId}`, `client-booking:${clientId}`].sort();
  for (const key of keys) {
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', {
      replacements: { key },
      transaction,
    });
  }
}

async function lockZoomConnection(lawyerId, transaction) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', {
    replacements: { key: `zoom-connection:${lawyerId}` }, transaction,
  });
}

const blockingStatusWhere = (now = new Date()) => ({
  [Op.or]: [
    { status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } },
    { status: 'payment_pending', createdAt: { [Op.gt]: new Date(now.getTime() - PAYMENT_RESERVATION_MINUTES * 60000) } },
  ],
});

const isPaymentReservationExpired = (consultation, now = new Date()) => (
  consultation?.status === 'payment_pending'
  && now.getTime() - new Date(consultation.createdAt).getTime() > PAYMENT_RESERVATION_MINUTES * 60000
);

async function assertAvailable({ lawyerId, clientId, window, excludeConsultationId, transaction }) {
  const where = {
    scheduledStartAt: { [Op.lt]: window.end.toJSDate() },
    scheduledEndAt: { [Op.gt]: window.start.toJSDate() },
    [Op.and]: [blockingStatusWhere(), { [Op.or]: [{ lawyerId }, ...(clientId ? [{ clientId }] : [])] }],
  };
  if (excludeConsultationId) where.id = { [Op.ne]: excludeConsultationId };
  const conflict = await Consultation.findOne({ where, transaction, lock: transaction?.LOCK?.UPDATE });
  if (conflict) throw slotError('SLOT_UNAVAILABLE', 'Это время уже занято', 409);
}

async function listAvailableSlots(lawyerId, { from, days = 21, duration = 60, clientTimezone }) {
  const profile = await LawyerProfile.findOne({
    where: { userId: lawyerId, verificationStatus: 'approved', isAvailable: true },
    include: [{ model: User, as: 'user', required: true, where: { isActive: true }, attributes: [] }],
  });
  if (!profile) throw slotError('LAWYER_NOT_FOUND', 'Юрист не найден', 404);
  const countDays = Math.min(31, Math.max(1, Number(days) || 21));
  const timezone = profile.timezone || 'Asia/Tashkent';
  const viewerTimezone = IANAZone.isValidZone(clientTimezone) ? clientTimezone : timezone;
  const first = from ? DateTime.fromISO(from, { zone: timezone }).startOf('day') : DateTime.now().setZone(timezone).startOf('day');
  if (!first.isValid) throw slotError('INVALID_DATE', 'Некорректная начальная дата');
  const rangeEnd = first.plus({ days: countDays + 1 }).toUTC();
  const occupied = await Consultation.findAll({
    where: {
      lawyerId,
      ...blockingStatusWhere(),
      scheduledStartAt: { [Op.lt]: rangeEnd.toJSDate() },
      scheduledEndAt: { [Op.gt]: first.toUTC().toJSDate() },
    },
    attributes: ['scheduledStartAt', 'scheduledEndAt'],
    raw: true,
  });
  const results = [];
  for (let offset = 0; offset < countDays; offset += 1) {
    const date = first.plus({ days: offset }).toISODate();
    const slots = [];
    for (let minute = 0; minute < 24 * 60; minute += SLOT_STEP_MINUTES) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      try {
        const window = validateWindow(profile, date, time, duration);
        const overlaps = occupied.some((item) => (
          DateTime.fromJSDate(item.scheduledStartAt) < window.end
          && DateTime.fromJSDate(item.scheduledEndAt) > window.start
        ));
        if (!overlaps) {
          const clientStart = window.start.setZone(viewerTimezone);
          slots.push({
            time, startsAt: window.start.toISO(), endsAt: window.end.toISO(),
            clientDate: clientStart.toISODate(), clientTime: clientStart.toFormat('HH:mm'),
          });
        }
      } catch (error) {
        if (!['INVALID_SLOT', 'MIN_LEAD_TIME', 'SLOT_UNAVAILABLE'].includes(error.code)) throw error;
      }
    }
    if (slots.length) results.push({ date, slots });
  }
  return {
    lawyerId, timezone, clientTimezone: viewerTimezone, duration: Number(duration), slotStepMinutes: SLOT_STEP_MINUTES,
    minLeadMinutes: MIN_LEAD_MINUTES, dates: results,
  };
}

module.exports = {
  DURATIONS, BLOCKING_STATUSES, PAYMENT_RESERVATION_MINUTES, MIN_LEAD_MINUTES, SLOT_STEP_MINUTES,
  validateWindow, lockLawyer, lockBookingParticipants, lockZoomConnection, blockingStatusWhere,
  isPaymentReservationExpired, assertAvailable, listAvailableSlots, slotError,
};

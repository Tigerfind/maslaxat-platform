const crypto = require('crypto');
const { Op } = require('sequelize');
const { DeadlineReminder, CaseDeadline, ClientCase, User, PushSubscription, Notification } = require('../models');
const { createNotification } = require('./notificationService');
const { sendMail, isEmailConfigured } = require('./emailService');
const pushService = require('./pushService');
const smsService = require('./smsService');
const logger = require('../config/logger');

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function messageFor(deadline) {
  const when = new Date(deadline.dueAt).toLocaleString('ru-RU', { timeZone: deadline.timezone });
  return `Срок по делу «${deadline.clientCase.title}»: ${deadline.title}. До ${when} (${deadline.timezone}).`;
}

async function deliver(reminder) {
  const deadline = reminder.deadline;
  const user = deadline.clientCase.client;
  const body = messageFor(deadline);
  const metadata = { clientCaseId: deadline.clientCaseId, deadlineId: deadline.id, reminderId: reminder.id };
  if (reminder.channel === 'in_app') {
    const existing = await Notification.findOne({ where: { userId: user.id, type: 'case_deadline', metadata: { [Op.contains]: { reminderId: reminder.id } } } });
    if (existing) return;
    const created = await createNotification(user.id, 'case_deadline', 'Напоминание о сроке', body, metadata, { push: false });
    if (!created) throw new Error('IN_APP_DELIVERY_FAILED');
    return;
  }
  if (reminder.channel === 'email') {
    if (user.settings?.emailNotifications === false || !user.email || !isEmailConfigured()) throw Object.assign(new Error('EMAIL_UNAVAILABLE'), { permanent: true });
    await sendMail({ to: user.email, subject: 'Напоминание о сроке — MaslaXat', text: body });
    return;
  }
  if (reminder.channel === 'push') {
    if (user.settings?.pushNotifications === false || !pushService.isEnabled()) throw Object.assign(new Error('PUSH_UNAVAILABLE'), { permanent: true });
    if (!await PushSubscription.count({ where: { userId: user.id } })) throw Object.assign(new Error('PUSH_SUBSCRIPTION_UNAVAILABLE'), { permanent: true });
    await pushService.sendToUser(user.id, { title: 'Напоминание о сроке', body, type: 'case_deadline', metadata });
    return;
  }
  if (!user.phone || !user.phoneVerifiedAt || !smsService.isConfigured()) throw Object.assign(new Error('SMS_UNAVAILABLE'), { permanent: true });
  const result = await smsService.sendSms(user.phone, body);
  if (!result?.sent) throw new Error('SMS_DELIVERY_FAILED');
}

async function claimReminder(id, now, leaseOwner) {
  const [claimed] = await DeadlineReminder.update({
    state: 'processing', leaseOwner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
  }, { where: {
    id,
    [Op.or]: [
      { state: { [Op.in]: ['scheduled', 'failed'] }, nextAttemptAt: { [Op.lte]: now }, [Op.or]: [{ leaseExpiresAt: null }, { leaseExpiresAt: { [Op.lt]: now } }] },
      { state: 'processing', leaseExpiresAt: { [Op.lt]: now } },
    ],
  } });
  return claimed === 1;
}

async function processDueReminders(now = new Date(), limit = 100) {
  const candidates = await DeadlineReminder.findAll({
    where: {
      [Op.or]: [
        { state: { [Op.in]: ['scheduled', 'failed'] }, nextAttemptAt: { [Op.lte]: now }, [Op.or]: [{ leaseExpiresAt: null }, { leaseExpiresAt: { [Op.lt]: now } }] },
        { state: 'processing', leaseExpiresAt: { [Op.lt]: now } },
      ],
    },
    include: [{ model: CaseDeadline, as: 'deadline', required: true, where: { status: 'pending' }, include: [{ model: ClientCase, as: 'clientCase', required: true, where: { status: { [Op.ne]: 'archived' } }, include: [{ model: User, as: 'client', attributes: ['id', 'name', 'email', 'phone', 'phoneVerifiedAt', 'settings'] }] }] }],
    order: [['nextAttemptAt', 'ASC']], limit,
  });
  let sent = 0;
  for (const candidate of candidates) {
    const leaseOwner = `${process.pid}:${crypto.randomUUID()}`;
    if (!await claimReminder(candidate.id, now, leaseOwner)) continue;
    try {
      await deliver(candidate);
      const [updated] = await DeadlineReminder.update({ state: 'sent', sentAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null }, { where: { id: candidate.id, state: 'processing', leaseOwner } });
      if (updated) sent += 1;
    } catch (error) {
      const attempts = candidate.attemptCount + 1;
      const permanent = Boolean(error.permanent) || attempts >= MAX_ATTEMPTS;
      await DeadlineReminder.update({
        state: permanent ? 'cancelled' : 'failed', attemptCount: attempts,
        nextAttemptAt: permanent ? candidate.nextAttemptAt : new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60000),
        leaseOwner: null, leaseExpiresAt: null, lastError: String(error.message || 'DELIVERY_FAILED').slice(0, 255),
      }, { where: { id: candidate.id, state: 'processing', leaseOwner } });
      logger.warn('[DeadlineReminder] delivery failed', { reminderId: candidate.id, channel: candidate.channel, attempts, permanent, message: error.message });
    }
  }
  return sent;
}

function startDeadlineReminderJob() {
  const run = () => processDueReminders().catch((error) => logger.error('[DeadlineReminder] job failed', { message: error.message }));
  const timer = setInterval(run, 60 * 1000);
  timer.unref?.();
  setTimeout(run, 10000).unref?.();
  logger.info('[DeadlineReminder] Job started');
  return timer;
}

module.exports = { LEASE_MS, MAX_ATTEMPTS, processDueReminders, startDeadlineReminderJob };

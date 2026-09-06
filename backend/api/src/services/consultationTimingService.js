const { Op } = require('sequelize');
const { sequelize, Consultation, MeetingEvent, User } = require('../models');
const lifecycle = require('./consultationLifecycleService');
const notificationService = require('./notificationService');
const logger = require('../config/logger');

const configuredNoShow = Number(process.env.CONSULTATION_NO_SHOW_MINUTES);
const configuredGrace = Number(process.env.CONSULTATION_GRACE_MINUTES);
const NO_SHOW_MINUTES = Number.isFinite(configuredNoShow) && configuredNoShow >= 5 ? configuredNoShow : 15;
const GRACE_MINUTES = Number.isFinite(configuredGrace) && configuredGrace >= 0 ? configuredGrace : 5;
const configuredSettle = Number(process.env.ZOOM_ATTENDANCE_SETTLE_MINUTES);
const ATTENDANCE_SETTLE_MINUTES = Number.isFinite(configuredSettle) && configuredSettle >= 5 ? configuredSettle : 10;

async function reconcileConsultationTiming(now = new Date()) {
  const noShowCutoff = new Date(now.getTime() - NO_SHOW_MINUTES * 60000);
  const candidates = await Consultation.findAll({
    where: {
      meetingProvider: 'zoom', status: { [Op.in]: ['accepted', 'in_progress'] },
      lifecycleStatus: { [Op.in]: ['ready', 'waiting_for_client', 'waiting_for_lawyer'] },
      scheduledStartAt: { [Op.lte]: noShowCutoff }, noShowCheckedAt: null,
    },
  });
  let noShows = 0;
  for (const consultation of candidates) {
    const [claimed] = await Consultation.update({ noShowCheckedAt: now }, { where: { id: consultation.id, noShowCheckedAt: null } });
    if (!claimed) continue;
    await consultation.reload();
    const clientFallback = !consultation.clientFirstJoinedAt && await MeetingEvent.findOne({ where: { consultationId: consultation.id, eventType: 'external_access_issued', participantRole: 'client' }, attributes: ['id'] });
    if (consultation.lawyerFirstJoinedAt && clientFallback) {
      await MeetingEvent.create({ consultationId: consultation.id, eventType: 'attendance.unverified', occurredAt: now, correlationId: lifecycle.correlationIdFor(consultation.id), metadata: { reason: 'external_client_fallback' } });
      const admins = await User.findAll({ where: { role: 'admin', isActive: true }, attributes: ['id'] });
      await Promise.allSettled(admins.map((admin) => notificationService.createNotification(admin.id, 'attendance_unverified', 'Требуется проверка участия', 'Клиент использовал внешний Zoom-клиент; проверьте attendance перед решением по оплате.', { consultationId: consultation.id })));
      continue;
    }
    const status = consultation.lawyerFirstJoinedAt ? 'no_show_client' : 'no_show_lawyer';
    await lifecycle.transition(consultation, status, { force: true, metadata: { noShowMinutes: NO_SHOW_MINUTES } });
    const absentId = status === 'no_show_client' ? consultation.clientId : consultation.lawyerId;
    const waitingId = status === 'no_show_client' ? consultation.lawyerId : consultation.clientId;
    await Promise.allSettled([
      notificationService.createNotification(absentId, status, 'Вы пропустили консультацию', 'Откройте консультацию или обратитесь в поддержку.', { consultationId: consultation.id }),
      notificationService.createNotification(waitingId, status, 'Участник не подключился', 'Вы можете перенести консультацию или обратиться в поддержку.', { consultationId: consultation.id }),
    ]);
    noShows += 1;
  }
  const overdue = await Consultation.findAll({
    where: { meetingProvider: 'zoom', status: 'in_progress', lifecycleStatus: 'in_progress', scheduledEndAt: { [Op.lte]: new Date(now.getTime() - GRACE_MINUTES * 60000) } },
  });
  let completed = 0;
  for (const consultation of overdue) {
    const [claimed] = await Consultation.update({
      lifecycleStatus: 'completed', finalLeftAt: consultation.finalLeftAt || now,
      graceEndsAt: consultation.graceEndsAt || new Date(new Date(consultation.scheduledEndAt).getTime() + GRACE_MINUTES * 60000),
      lawyerEndedAt: consultation.lawyerEndedAt || now,
    }, { where: { id: consultation.id, lifecycleStatus: 'in_progress' } });
    if (!claimed) continue;
    await MeetingEvent.create({ consultationId: consultation.id, eventType: 'lifecycle.completed', occurredAt: now, correlationId: lifecycle.correlationIdFor(consultation.id), metadata: { graceMinutes: GRACE_MINUTES } });
    const zoomMeetingService = require('./zoomMeetingService');
    zoomMeetingService.endMeeting(consultation.id).catch(() => {});
    logger.info('meeting_completed', { consultationId: consultation.id, correlationId: lifecycle.correlationIdFor(consultation.id), source: 'grace_timeout' });
    await notificationService.createNotification(consultation.clientId, 'consultation_completion_requested', 'Время консультации завершено', 'Подтвердите результат или обратитесь в поддержку.', { consultationId: consultation.id });
    completed += 1;
  }
  const noShowsToEnd = await Consultation.findAll({ where: {
    meetingProvider: 'zoom', lifecycleStatus: { [Op.in]: ['no_show_client', 'no_show_lawyer'] },
    lawyerEndedAt: null, scheduledEndAt: { [Op.lte]: new Date(now.getTime() - GRACE_MINUTES * 60000) },
  } });
  for (const consultation of noShowsToEnd) {
    const graceEndedAt = new Date(new Date(consultation.scheduledEndAt).getTime() + GRACE_MINUTES * 60000);
    const [claimed] = await Consultation.update({ finalLeftAt: consultation.finalLeftAt || now, lawyerEndedAt: graceEndedAt }, { where: { id: consultation.id, lawyerEndedAt: null } });
    if (claimed) {
      require('./zoomMeetingService').endMeeting(consultation.id).catch(() => {});
    }
  }
  const refundsToFinalize = await Consultation.findAll({ where: {
    meetingProvider: 'zoom', lifecycleStatus: 'no_show_lawyer',
    lawyerEndedAt: { [Op.lte]: new Date(now.getTime() - ATTENDANCE_SETTLE_MINUTES * 60000) },
  }, attributes: ['id'] });
  let refundsFinalized = 0;
  for (const item of refundsToFinalize) {
    await sequelize.transaction(async (transaction) => {
      const locked = await Consultation.findByPk(item.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (locked?.lifecycleStatus !== 'no_show_lawyer') return;
      const { refundConsultationEscrow } = require('./escrow');
      const result = await refundConsultationEscrow(locked.id, {
        transaction,
        requestedBy: locked.clientId,
        source: 'no_show',
        reason: 'Юрист не подключился к Zoom-консультации',
      });
      if (result.refunded > 0) refundsFinalized += 1;
    });
  }
  return { noShows, completed, noShowMeetingsEnded: noShowsToEnd.length, refundsFinalized };
}

function startTimingJob() {
  const run = () => reconcileConsultationTiming().catch((error) => logger.error('Consultation timing job failed', { code: error.code }));
  const timer = setInterval(run, 60 * 1000); timer.unref?.(); setTimeout(run, 20000).unref?.();
}

module.exports = { NO_SHOW_MINUTES, GRACE_MINUTES, ATTENDANCE_SETTLE_MINUTES, reconcileConsultationTiming, startTimingJob };

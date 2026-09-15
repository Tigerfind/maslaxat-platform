const router = require('express').Router();
const { Op, QueryTypes } = require('sequelize');
const { DateTime } = require('luxon');
const {
  sequelize, User, LawyerProfile, Consultation, ConsultationMeeting, Payment, Message, Document,
  ClientCase, CaseDeadline, DeadlineReminder, CaseAuditEvent, CLIENT_CASE_STATUSES,
} = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const policy = require('../services/consultationPolicy');
const { safeLawyer, safeConsultation, safePayment } = require('../services/clientCabinetSerializers');

router.use(['/dashboard', '/lawyers/history', '/messages', '/cases', '/deadlines'], authenticate, authorize('client'));

const CASE_ACTIVE_STATUSES = CLIENT_CASE_STATUSES.filter((status) => !['resolved', 'closed', 'archived'].includes(status));
const DEADLINE_STATUSES = ['pending', 'completed', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const SOURCES = ['manual', 'consultation', 'document', 'ai'];
const CHANNELS = ['in_app', 'email', 'push', 'sms'];
const PRESET_INTERVALS = { '24h': 1440, '1h': 60, '10m': 10 };
const pageParams = (query, defaultLimit = 20) => ({
  page: Math.max(1, Number.parseInt(query.page, 10) || 1),
  limit: Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit)),
});
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const pattern = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

function parseDueAt(value, timezone) {
  if (typeof timezone !== 'string' || !DateTime.local().setZone(timezone).isValid) return { error: 'Некорректный часовой пояс' };
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return { error: 'dueAt должен содержать UTC offset' };
  const date = DateTime.fromISO(value, { setZone: true });
  if (!date.isValid) return { error: 'Некорректная дата срока' };
  return { date: date.toUTC().toJSDate(), timezone };
}

function parseReminders(items, dueAt) {
  if (items === undefined) return null;
  if (!Array.isArray(items) || items.length > 20) return { error: 'Некорректные напоминания' };
  const reminders = [];
  const seen = new Set();
  for (const item of items) {
    const interval = PRESET_INTERVALS[item.interval] ?? Number.parseInt(item.customMinutes ?? item.intervalMinutes, 10);
    const channel = item.channel || 'in_app';
    if (!Number.isInteger(interval) || interval < 0 || interval > 525600 || !CHANNELS.includes(channel)) return { error: 'Некорректное напоминание' };
    const remindAt = new Date(dueAt.getTime() - interval * 60000);
    const key = `${channel}:${remindAt.toISOString()}`;
    if (!seen.has(key)) reminders.push({ intervalMinutes: interval, channel, remindAt });
    seen.add(key);
  }
  return reminders;
}

async function ownedCase(id, clientId, options = {}) {
  return ClientCase.findOne({ where: { id, clientId }, ...options });
}

async function audit(clientCaseId, actorUserId, eventType, metadata, transaction) {
  return CaseAuditEvent.create({ clientCaseId, actorUserId, eventType, metadata: metadata || {} }, { transaction });
}

async function replaceReminders(deadline, reminders, transaction) {
  if (reminders === null) return;
  await DeadlineReminder.update({ state: 'cancelled', leaseOwner: null, leaseExpiresAt: null }, {
    where: { deadlineId: deadline.id, state: { [Op.in]: ['scheduled', 'processing', 'failed'] } }, transaction,
  });
  for (const reminder of reminders) {
    const idempotencyKey = `${deadline.id}:${reminder.channel}:${reminder.remindAt.toISOString()}`;
    const [row] = await DeadlineReminder.findOrCreate({
      where: { idempotencyKey },
      defaults: { deadlineId: deadline.id, ...reminder, state: 'scheduled', nextAttemptAt: reminder.remindAt, idempotencyKey },
      transaction,
    });
    if (row.state !== 'sent') await row.update({ ...reminder, state: 'scheduled', nextAttemptAt: reminder.remindAt, leaseOwner: null, leaseExpiresAt: null, lastError: null }, { transaction });
  }
}

const lawyerInclude = { model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'], include: [{ model: LawyerProfile, as: 'profile', attributes: ['specialization', 'specializations', 'rating'] }] };

router.get('/dashboard', async (req, res, next) => {
  try {
    const now = new Date();
    const nextConsultationRow = await Consultation.findOne({
      where: { clientId: req.userId, archivedAt: null, [Op.or]: [{ status: 'in_progress' }, { status: { [Op.in]: policy.ACTIVE_STATUSES.filter((status) => status !== 'in_progress') }, scheduledStartAt: { [Op.gte]: now } }] },
      include: [lawyerInclude, { model: ConsultationMeeting, as: 'meeting', attributes: ['provider', 'status', 'scheduledAt', 'duration', 'startedAt', 'endedAt', 'lastSafeError'] }, { model: Payment, as: 'payments', attributes: ['id', 'status', 'refundStatus'], separate: true }],
      order: [[sequelize.literal(`CASE WHEN "Consultation"."status" = 'in_progress' THEN 0 ELSE 1 END`), 'ASC'], ['scheduledStartAt', 'ASC']],
    });
    const [pendingPaymentsCount, activeCasesCount, unreadMessagesCount, upcomingDeadlines, recentDocuments, recentPayments, documentsAttentionCount, consultationsCount] = await Promise.all([
      Payment.count({ where: { userId: req.userId, status: 'pending' } }),
      ClientCase.count({ where: { clientId: req.userId, status: { [Op.in]: CASE_ACTIVE_STATUSES } } }),
      Message.count({ include: [{ model: Consultation, required: true, attributes: [], where: { clientId: req.userId } }], where: { senderId: { [Op.ne]: req.userId }, isRead: false } }),
      CaseDeadline.findAll({ include: [{ model: ClientCase, as: 'clientCase', required: true, attributes: ['id', 'title'], where: { clientId: req.userId } }], where: { status: 'pending', dueAt: { [Op.gte]: now } }, order: [['dueAt', 'ASC']], limit: 5 }),
      Document.findAll({ where: { userId: req.userId, archivedAt: null }, attributes: { exclude: ['path'] }, order: [['updatedAt', 'DESC']], limit: 5 }),
      Payment.findAll({ where: { userId: req.userId }, include: [{ model: Consultation, attributes: ['id', 'type', 'preferredDate', 'preferredTime'], include: [lawyerInclude] }], order: [['createdAt', 'DESC']], limit: 5 }),
      Document.count({ where: { userId: req.userId, archivedAt: null, status: { [Op.in]: ['issues', 'rejected'] } } }),
      Consultation.count({ where: { clientId: req.userId } }),
    ]);
    res.json({
      nextConsultation: nextConsultationRow ? safeConsultation(nextConsultationRow, 'client', now) : null,
      pendingPaymentsCount, activeCasesCount, unreadMessagesCount, upcomingDeadlines,
      recentDocuments, recentPayments: recentPayments.map(safePayment), documentsAttentionCount,
      onboarding: { profile: Boolean(req.user.name && (req.user.email || req.user.phone)), document: recentDocuments.length > 0, consultation: consultationsCount > 0, email: Boolean(req.user.isVerified) },
    });
  } catch (error) { next(error); }
});

router.get('/lawyers/history', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req.query);
    const search = text(req.query.search, 100);
    const replacements = { clientId: req.userId, limit, offset: (page - 1) * limit, search: `%${search.replace(/[\\%_]/g, '\\$&')}%` };
    const searchSql = search ? 'AND u.name ILIKE :search' : '';
    const [rows, countRows] = await Promise.all([
      sequelize.query(`SELECT u.id, u.name, u.avatar, lp.professional_title, lp.specialization, lp.specializations, lp.rating, lp.reviews_count, lp.experience, lp.languages, lp.price, lp.is_available, MAX(c.updated_at) AS "lastConsultationAt", (ARRAY_AGG(c.type ORDER BY c.updated_at DESC))[1] AS "lastType", (ARRAY_AGG(c.specialization ORDER BY c.updated_at DESC))[1] AS "lastSpecialization" FROM consultations c JOIN users u ON u.id = c.lawyer_id LEFT JOIN lawyer_profiles lp ON lp.user_id = u.id WHERE c.client_id = :clientId ${searchSql} GROUP BY u.id, u.name, u.avatar, lp.professional_title, lp.specialization, lp.specializations, lp.rating, lp.reviews_count, lp.experience, lp.languages, lp.price, lp.is_available ORDER BY "lastConsultationAt" DESC LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT }),
      sequelize.query(`SELECT COUNT(DISTINCT c.lawyer_id)::int AS count FROM consultations c JOIN users u ON u.id = c.lawyer_id WHERE c.client_id = :clientId ${searchSql}`, { replacements, type: QueryTypes.SELECT }),
    ]);
    const total = Number(countRows[0]?.count) || 0;
    res.json({ lawyers: rows.map((row) => ({ ...safeLawyer({ ...row, profile: { ...row, professionalTitle: row.professional_title, reviewsCount: row.reviews_count, isAvailable: row.is_available } }), lastConsultationAt: row.lastConsultationAt, latestConsultation: { type: row.lastType, specialization: row.lastSpecialization, createdAt: row.lastConsultationAt } })), page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

router.get('/messages', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req.query);
    const where = { clientId: req.userId };
    if (req.query.status && policy.STATUSES.includes(req.query.status)) where.status = req.query.status;
    const search = text(req.query.search, 100);
    if (search) where['$lawyer.name$'] = { [Op.iLike]: pattern(search) };
    const { rows, count } = await Consultation.findAndCountAll({ where, include: [lawyerInclude], order: [['updatedAt', 'DESC']], limit, offset: (page - 1) * limit, distinct: true, subQuery: false });
    const summaries = await Promise.all(rows.map(async (consultation) => {
      const [lastMessage, unreadCount] = await Promise.all([
        Message.findOne({ where: { consultationId: consultation.id }, attributes: ['id', 'text', 'senderId', 'createdAt'], order: [['createdAt', 'DESC'], ['id', 'DESC']] }),
        Message.count({ where: { consultationId: consultation.id, senderId: { [Op.ne]: req.userId }, isRead: false } }),
      ]);
      const item = safeConsultation(consultation, 'client');
      return { consultationId: consultation.id, consultationStatus: consultation.status, policy: item.policy, access: item.access, partner: safeLawyer(consultation.lawyer), lastMessage: lastMessage ? { id: lastMessage.id, excerpt: lastMessage.text.slice(0, 160), senderId: lastMessage.senderId, createdAt: lastMessage.createdAt } : null, unreadCount };
    }));
    const totalUnread = await Message.count({ include: [{ model: Consultation, required: true, attributes: [], where: { clientId: req.userId } }], where: { senderId: { [Op.ne]: req.userId }, isRead: false } });
    res.json({ conversations: summaries, totalUnread, page, limit, total: count, totalPages: Math.ceil(count / limit) });
  } catch (error) { next(error); }
});

router.post('/cases', async (req, res, next) => {
  try {
    const title = text(req.body.title, 200);
    const description = text(req.body.description, 10000) || null;
    const status = req.body.status || 'draft';
    if (!title) return res.status(400).json({ error: 'Название дела обязательно' });
    if (!CLIENT_CASE_STATUSES.includes(status) || status === 'archived') return res.status(400).json({ error: 'Некорректный статус дела' });
    const result = await sequelize.transaction(async (transaction) => {
      const clientCase = await ClientCase.create({ clientId: req.userId, title, description, status }, { transaction });
      await audit(clientCase.id, req.userId, 'case_created', { status }, transaction);
      return clientCase;
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

router.get('/cases', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req.query);
    const where = { clientId: req.userId };
    if (req.query.status && CLIENT_CASE_STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (req.query.archived === 'true') where.status = 'archived';
    else if (!req.query.status) where.status = { [Op.ne]: 'archived' };
    const search = text(req.query.search, 100);
    if (search) where[Op.or] = [{ title: { [Op.iLike]: pattern(search) } }, { description: { [Op.iLike]: pattern(search) } }];
    const { rows, count } = await ClientCase.findAndCountAll({ where, order: [['updatedAt', 'DESC'], ['id', 'ASC']], limit, offset: (page - 1) * limit });
    const cases = await Promise.all(rows.map(async (clientCase) => {
      const [documentsCount, consultationsCount, nextDeadline, lastConsultation] = await Promise.all([
        Document.count({ where: { clientCaseId: clientCase.id, userId: req.userId } }),
        Consultation.count({ where: { clientCaseId: clientCase.id, clientId: req.userId } }),
        CaseDeadline.findOne({ where: { clientCaseId: clientCase.id, status: 'pending' }, attributes: ['id', 'title', 'dueAt', 'timezone'], order: [['dueAt', 'ASC']] }),
        Consultation.findOne({ where: { clientCaseId: clientCase.id, clientId: req.userId }, include: [lawyerInclude], order: [['updatedAt', 'DESC']] }),
      ]);
      return { ...clientCase.toJSON(), documentsCount, consultationsCount, nextDeadline, lawyer: lastConsultation?.lawyer ? safeLawyer(lastConsultation.lawyer) : null, lastActivityAt: lastConsultation?.updatedAt || clientCase.updatedAt };
    }));
    const statusRows = await ClientCase.findAll({ where: { clientId: req.userId }, attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']], group: ['status'], raw: true });
    const counts = Object.fromEntries(statusRows.map((item) => [item.status, Number(item.count)]));
    res.json({ cases, counts, page, limit, total: count, totalPages: Math.ceil(count / limit) });
  } catch (error) { next(error); }
});

router.get('/cases/:id', async (req, res, next) => {
  try {
    const clientCase = await ownedCase(req.params.id, req.userId, { include: [
      { model: Consultation, as: 'consultations', include: [lawyerInclude] },
      { model: Document, as: 'documents', attributes: { exclude: ['path'] } },
      { model: CaseDeadline, as: 'deadlines', include: [{ model: DeadlineReminder, as: 'reminders' }] },
      { model: CaseAuditEvent, as: 'events', separate: true, order: [['createdAt', 'DESC']], limit: 100 },
    ] });
    if (!clientCase) return res.status(404).json({ error: 'Дело не найдено' });
    const value = clientCase.toJSON();
    value.consultations = value.consultations.map((item) => safeConsultation(item, 'client'));
    const lawyerMap = new Map(value.consultations.filter((item) => item.lawyer).map((item) => [item.lawyer.id, item.lawyer]));
    const consultationIds = value.consultations.map((item) => item.id);
    const [messagesCount, unreadMessagesCount] = consultationIds.length ? await Promise.all([
      Message.count({ where: { consultationId: { [Op.in]: consultationIds } } }),
      Message.count({ where: { consultationId: { [Op.in]: consultationIds }, senderId: { [Op.ne]: req.userId }, isRead: false } }),
    ]) : [0, 0];
    value.lawyers = [...lawyerMap.values()];
    value.lawyer = value.lawyers[0] || null;
    value.timeline = value.events || [];
    value.conversations = await Promise.all(value.consultations.map(async (item) => {
      const lastMessage = await Message.findOne({ where: { consultationId: item.id }, attributes: ['id', 'text', 'createdAt'], order: [['createdAt', 'DESC'], ['id', 'DESC']] });
      return { consultationId: item.id, title: item.question, status: item.status, lastMessage: lastMessage ? { id: lastMessage.id, excerpt: lastMessage.text.slice(0, 160), createdAt: lastMessage.createdAt } : null };
    }));
    value.messages = { count: messagesCount, unreadCount: unreadMessagesCount };
    res.json(value);
  } catch (error) { next(error); }
});

router.patch('/cases/:id', async (req, res, next) => {
  try {
    const updates = {};
    if (req.body.title !== undefined) { updates.title = text(req.body.title, 200); if (!updates.title) return res.status(400).json({ error: 'Название дела обязательно' }); }
    if (req.body.description !== undefined) updates.description = text(req.body.description, 10000) || null;
    if (req.body.status !== undefined) { if (!CLIENT_CASE_STATUSES.includes(req.body.status) || req.body.status === 'archived') return res.status(400).json({ error: 'Некорректный статус дела' }); updates.status = req.body.status; updates.archivedAt = null; }
    const result = await sequelize.transaction(async (transaction) => {
      const clientCase = await ownedCase(req.params.id, req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!clientCase) return null;
      const previous = { title: clientCase.title, description: clientCase.description, status: clientCase.status };
      await clientCase.update(updates, { transaction });
      await audit(clientCase.id, req.userId, 'case_updated', { previous, changes: updates }, transaction);
      return clientCase;
    });
    if (!result) return res.status(404).json({ error: 'Дело не найдено' });
    res.json(result);
  } catch (error) { next(error); }
});

router.patch('/cases/:id/archive', async (req, res, next) => {
  try {
    const archived = req.body.archived !== false;
    const result = await sequelize.transaction(async (transaction) => {
      const clientCase = await ownedCase(req.params.id, req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!clientCase) return null;
      let nextStatus = 'archived';
      const previousStatus = clientCase.status;
      if (!archived) {
        const archiveEvent = await CaseAuditEvent.findOne({ where: { clientCaseId: clientCase.id, eventType: 'case_archived' }, order: [['createdAt', 'DESC']], transaction });
        nextStatus = CLIENT_CASE_STATUSES.includes(archiveEvent?.metadata?.previousStatus) && archiveEvent.metadata.previousStatus !== 'archived' ? archiveEvent.metadata.previousStatus : 'draft';
      }
      await clientCase.update({ status: nextStatus, archivedAt: archived ? new Date() : null }, { transaction });
      await audit(clientCase.id, req.userId, archived ? 'case_archived' : 'case_unarchived', { previousStatus }, transaction);
      return clientCase;
    });
    if (!result) return res.status(404).json({ error: 'Дело не найдено' });
    res.json(result);
  } catch (error) { next(error); }
});

async function setCaseLink(req, res, next, Model, key, eventPrefix) {
  try {
    const result = await sequelize.transaction(async (transaction) => {
      const clientCase = await ownedCase(req.params.id, req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!clientCase) return { missingCase: true };
      const where = { id: req.params[key] };
      if (Model === Consultation) where.clientId = req.userId; else where.userId = req.userId;
      const item = await Model.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
      if (!item) return { missingItem: true };
      if (req.method === 'PUT' && item.clientCaseId && item.clientCaseId !== clientCase.id) return { conflict: true };
      const linked = req.method === 'PUT';
      if (!linked && item.clientCaseId !== clientCase.id) return { missingItem: true };
      await item.update({ clientCaseId: linked ? clientCase.id : null }, { transaction });
      await audit(clientCase.id, req.userId, `${eventPrefix}_${linked ? 'linked' : 'unlinked'}`, { [`${eventPrefix}Id`]: item.id }, transaction);
      return { item };
    });
    if (result.missingCase || result.missingItem) return res.status(404).json({ error: 'Ресурс не найден' });
    if (result.conflict) return res.status(409).json({ error: 'Ресурс уже связан с другим делом' });
    res.json({ success: true });
  } catch (error) { next(error); }
}

router.put('/cases/:id/consultations/:consultationId', (req, res, next) => setCaseLink(req, res, next, Consultation, 'consultationId', 'consultation'));
router.delete('/cases/:id/consultations/:consultationId', (req, res, next) => setCaseLink(req, res, next, Consultation, 'consultationId', 'consultation'));
router.put('/cases/:id/documents/:documentId', (req, res, next) => setCaseLink(req, res, next, Document, 'documentId', 'document'));
router.delete('/cases/:id/documents/:documentId', (req, res, next) => setCaseLink(req, res, next, Document, 'documentId', 'document'));

router.get('/cases/:id/events', async (req, res, next) => {
  try {
    const clientCase = await ownedCase(req.params.id, req.userId);
    if (!clientCase) return res.status(404).json({ error: 'Дело не найдено' });
    const { page, limit } = pageParams(req.query);
    const { rows, count } = await CaseAuditEvent.findAndCountAll({ where: { clientCaseId: clientCase.id }, order: [['createdAt', 'DESC']], limit, offset: (page - 1) * limit });
    res.json({ events: rows, page, limit, total: count, totalPages: Math.ceil(count / limit) });
  } catch (error) { next(error); }
});

router.get('/deadlines', async (req, res, next) => {
  try {
    const { page, limit } = pageParams(req.query);
    const where = {};
    if (req.query.status && DEADLINE_STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (req.query.status === 'upcoming') { where.status = 'pending'; where.dueAt = { [Op.gte]: new Date() }; }
    if (req.query.status === 'overdue') { where.status = 'pending'; where.dueAt = { [Op.lt]: new Date() }; }
    if (req.query.priority && PRIORITIES.includes(req.query.priority)) where.priority = req.query.priority;
    if (req.query.from || req.query.to) {
      const from = req.query.from ? new Date(req.query.from) : null;
      const to = req.query.to ? new Date(req.query.to) : null;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return res.status(400).json({ error: 'Некорректный диапазон дат' });
      where.dueAt = { ...(where.dueAt || {}), ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };
    }
    const include = [{ model: ClientCase, as: 'clientCase', required: true, attributes: ['id', 'title'], where: { clientId: req.userId } }, { model: DeadlineReminder, as: 'reminders' }];
    const { rows, count } = await CaseDeadline.findAndCountAll({ where, include, distinct: true, order: [['dueAt', 'ASC']], limit, offset: (page - 1) * limit });
    res.json({ deadlines: rows, page, limit, total: count, totalPages: Math.ceil(count / limit) });
  } catch (error) { next(error); }
});

router.post('/cases/:id/deadlines', async (req, res, next) => {
  try {
    const title = text(req.body.title, 200);
    const parsed = parseDueAt(req.body.dueAt, req.body.timezone || 'Asia/Tashkent');
    if (!title) return res.status(400).json({ error: 'Название срока обязательно' });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!PRIORITIES.includes(req.body.priority || 'medium') || !SOURCES.includes(req.body.source || 'manual')) return res.status(400).json({ error: 'Некорректные параметры срока' });
    const reminders = parseReminders(req.body.reminders || [], parsed.date);
    if (reminders.error) return res.status(400).json({ error: reminders.error });
    const result = await sequelize.transaction(async (transaction) => {
      const clientCase = await ownedCase(req.params.id, req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!clientCase) return null;
      const deadline = await CaseDeadline.create({ clientCaseId: clientCase.id, title, description: text(req.body.description, 5000) || null, dueAt: parsed.date, timezone: parsed.timezone, priority: req.body.priority || 'medium', source: req.body.source || 'manual' }, { transaction });
      await replaceReminders(deadline, reminders, transaction);
      await audit(clientCase.id, req.userId, 'deadline_created', { deadlineId: deadline.id, source: deadline.source }, transaction);
      return CaseDeadline.findByPk(deadline.id, { include: [{ model: DeadlineReminder, as: 'reminders' }], transaction });
    });
    if (!result) return res.status(404).json({ error: 'Дело не найдено' });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

async function mutateDeadline(req, res, next, operation) {
  try {
    const result = await sequelize.transaction(async (transaction) => {
      const clientCase = await ownedCase(req.params.id, req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!clientCase) return null;
      const deadline = await CaseDeadline.findOne({ where: { id: req.params.deadlineId, clientCaseId: clientCase.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!deadline) return null;
      if (operation === 'delete') {
        await deadline.update({ status: 'cancelled', completedAt: null }, { transaction });
        await DeadlineReminder.update({ state: 'cancelled', leaseOwner: null, leaseExpiresAt: null }, { where: { deadlineId: deadline.id, state: { [Op.ne]: 'sent' } }, transaction });
        await audit(clientCase.id, req.userId, 'deadline_deleted', { deadlineId: deadline.id }, transaction);
        return { deleted: true };
      }
      const updates = {};
      if (operation === 'complete') Object.assign(updates, { status: 'completed', completedAt: new Date() });
      if (operation === 'patch') {
        if (req.body.title !== undefined) { updates.title = text(req.body.title, 200); if (!updates.title) throw Object.assign(new Error('Название срока обязательно'), { status: 400 }); }
        if (req.body.description !== undefined) updates.description = text(req.body.description, 5000) || null;
        if (req.body.status !== undefined) { if (!DEADLINE_STATUSES.includes(req.body.status)) throw Object.assign(new Error('Некорректный статус срока'), { status: 400 }); updates.status = req.body.status; updates.completedAt = req.body.status === 'completed' ? new Date() : null; }
        if (req.body.priority !== undefined) { if (!PRIORITIES.includes(req.body.priority)) throw Object.assign(new Error('Некорректный приоритет'), { status: 400 }); updates.priority = req.body.priority; }
        if (req.body.source !== undefined) { if (!SOURCES.includes(req.body.source)) throw Object.assign(new Error('Некорректный источник'), { status: 400 }); updates.source = req.body.source; }
        if (req.body.dueAt !== undefined || req.body.timezone !== undefined) {
          const parsed = parseDueAt(req.body.dueAt || deadline.dueAt.toISOString(), req.body.timezone || deadline.timezone);
          if (parsed.error) throw Object.assign(new Error(parsed.error), { status: 400 });
          updates.dueAt = parsed.date; updates.timezone = parsed.timezone;
        }
      }
      await deadline.update(updates, { transaction });
      if (deadline.status !== 'pending') {
        await DeadlineReminder.update({ state: 'cancelled', leaseOwner: null, leaseExpiresAt: null }, { where: { deadlineId: deadline.id, state: { [Op.ne]: 'sent' } }, transaction });
      } else {
        const reminders = parseReminders(req.body.reminders, deadline.dueAt);
        if (reminders?.error) throw Object.assign(new Error(reminders.error), { status: 400 });
        if (reminders !== null) await replaceReminders(deadline, reminders, transaction);
        else if (updates.dueAt) {
          const existing = await DeadlineReminder.findAll({ where: { deadlineId: deadline.id, state: { [Op.ne]: 'sent' } }, transaction });
          await replaceReminders(deadline, existing.map((item) => ({ channel: item.channel, intervalMinutes: item.intervalMinutes, remindAt: new Date(deadline.dueAt.getTime() - item.intervalMinutes * 60000) })), transaction);
        }
      }
      await audit(clientCase.id, req.userId, operation === 'complete' ? 'deadline_completed' : 'deadline_updated', { deadlineId: deadline.id }, transaction);
      return CaseDeadline.findByPk(deadline.id, { include: [{ model: DeadlineReminder, as: 'reminders' }], transaction });
    });
    if (!result) return res.status(404).json({ error: 'Срок не найден' });
    res.json(result);
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); next(error); }
}

router.patch('/cases/:id/deadlines/:deadlineId', (req, res, next) => mutateDeadline(req, res, next, 'patch'));
router.patch('/cases/:id/deadlines/:deadlineId/complete', (req, res, next) => mutateDeadline(req, res, next, 'complete'));
router.delete('/cases/:id/deadlines/:deadlineId', (req, res, next) => mutateDeadline(req, res, next, 'delete'));

module.exports = router;

const crypto = require('crypto');
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { Consultation, ConsultationMeeting, MeetingEvent, User, ZoomConnection } = require('../models');
const store = require('../services/oauthTransactionStore');
const secretBox = require('../services/secretBox');
const zoomApi = require('../services/zoomApiService');
const zoomConnectionService = require('../services/zoomConnectionService');
const { consultationAccess } = require('../services/consultationAccessService');
const meetingSdk = require('../services/zoomMeetingSdkService');
const lifecycle = require('../services/consultationLifecycleService');
const { distributedRateLimit } = require('../middleware/distributedRateLimit');

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url');
const meetingAccessLimiter = distributedRateLimit({
  prefix: 'zoom-meeting-access', windowSeconds: 60 * 60,
  max: process.env.NODE_ENV === 'production' ? 60 : 1000,
  keyGenerator: (req) => `${req.userId}:${req.params.id}`,
});

router.get('/status', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const connection = await ZoomConnection.findOne({ where: { userId: req.userId }, attributes: ['status', 'zoomEmail', 'tokenExpiresAt', 'connectedAt', 'lastError'] });
    return res.json({
      enabled: zoomApi.enabled(), sdkEnabled: meetingSdk.sdkEnabled(),
      webhookConfigured: Boolean(process.env.ZOOM_WEBHOOK_SECRET),
      connected: connection?.status === 'connected', connection,
    });
  } catch (error) { return next(error); }
});

router.post('/oauth/authorize', authenticate, authorize('lawyer'), async (req, res) => {
  if (!zoomApi.enabled()) return res.status(503).json({ error: 'Zoom OAuth не настроен' });
  try {
    const existing = await ZoomConnection.findOne({ where: { userId: req.userId, status: 'connected' }, attributes: ['id'] });
    if (existing) return res.status(409).json({ error: 'Zoom уже подключён. Сначала отключите текущий аккаунт.' });
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const binding = crypto.randomBytes(32).toString('base64url');
    await store.put('zoom-state', state, { userId: req.userId, verifier, bindingHash: hash(binding) }, 600);
    const challenge = hash(verifier);
    const params = new URLSearchParams({
      response_type: 'code', client_id: process.env.ZOOM_CLIENT_ID,
      redirect_uri: process.env.ZOOM_REDIRECT_URI, state,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    res.cookie('zoom_oauth_bind', binding, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 600000, path: '/api/zoom' });
    return res.json({ authorizationUrl: `https://zoom.us/oauth/authorize?${params}` });
  } catch (error) {
    return res.status(503).json({ error: 'Не удалось начать подключение Zoom' });
  }
});

router.get('/oauth/callback', async (req, res) => {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (req.query.error) return res.redirect(`${frontend}/settings?zoom=cancelled`);
  try {
    const attempt = await store.consume('zoom-state', req.query.state);
    const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('zoom_oauth_bind='));
    const binding = cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : '';
    if (!attempt || hash(binding) !== attempt.bindingHash) throw new Error('Invalid Zoom OAuth state');
    const lawyer = await User.findOne({ where: { id: attempt.userId, role: 'lawyer', isActive: true }, attributes: ['id'] });
    if (!lawyer) throw new Error('Lawyer account unavailable');
    const tokens = await zoomApi.tokenRequest({
      grant_type: 'authorization_code', code: req.query.code,
      redirect_uri: process.env.ZOOM_REDIRECT_URI, code_verifier: attempt.verifier,
    });
    const tempConnection = { userId: attempt.userId, tokenExpiresAt: new Date(Date.now() + 3600000), accessTokenEncrypted: secretBox.encrypt(tokens.access_token, `zoom:${attempt.userId}:access`) };
    const me = await zoomApi.userProfile(tokens.access_token);
    if (!me.id) throw new Error('Zoom user lookup failed');
    await ZoomConnection.upsert({
      userId: attempt.userId, zoomUserId: String(me.id), zoomAccountId: me.account_id || null,
      zoomEmail: me.email || null,
      accessTokenEncrypted: tempConnection.accessTokenEncrypted,
      refreshTokenEncrypted: secretBox.encrypt(tokens.refresh_token, `zoom:${attempt.userId}:refresh`),
      tokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
      scopes: String(tokens.scope || '').split(' ').filter(Boolean), status: 'connected', lastError: null,
      connectedAt: new Date(), disconnectedAt: null,
    });
    res.clearCookie('zoom_oauth_bind', { path: '/api/zoom' });
    return res.redirect(`${frontend}/settings?zoom=connected`);
  } catch (error) {
    res.clearCookie('zoom_oauth_bind', { path: '/api/zoom' });
    return res.redirect(`${frontend}/settings?zoom=failed`);
  }
});

router.delete('/connection', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const result = await zoomConnectionService.disconnect(req.userId);
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
});

router.post('/consultations/:id/access', authenticate, meetingAccessLimiter, async (req, res, next) => {
  try {
    let consultation = await Consultation.findByPk(req.params.id, { include: [{ model: ConsultationMeeting, as: 'meeting' }] });
    if (!consultation || ![consultation.clientId, consultation.lawyerId].includes(req.userId)) return res.status(403).json({ error: 'Нет доступа' });
    if (consultation.meetingProvider === 'zoom' && consultation.status === 'accepted'
      && (!consultation.meeting || !['ready', 'started'].includes(consultation.meeting.status))) {
      const service = require('../services/zoomMeetingService');
      const queued = await service.ensureProvisionQueued(consultation.id);
      if (queued) setImmediate(() => service.processMeetingOperation(queued.id).catch(() => {}));
      return res.status(202).json({ error: 'Подготавливаем видеовстречу', code: 'MEETING_PREPARING' });
    }
    if (consultation.meetingProvider !== 'zoom' || !consultation.meeting || !['ready', 'started'].includes(consultation.meeting.status)) return res.status(409).json({ error: 'Zoom-встреча ещё не готова', code: 'MEETING_NOT_READY' });
    if (!['accepted', 'in_progress'].includes(consultation.status)) return res.status(409).json({ error: 'Консультация недоступна для подключения' });
    const access = consultationAccess(consultation);
    if (!access.canJoin) return res.status(403).json({ error: 'Подключение пока недоступно', code: access.reason, ...access });
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' });
    return res.json(await meetingSdk.externalAccess(consultation.id, req.userId));
  } catch (error) { return next(error); }
});

router.get('/consultations/:id/preflight', authenticate, async (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    return res.json(await meetingSdk.preflight(req.params.id, req.userId));
  } catch (error) { return next(error); }
});

router.post('/consultations/:id/sdk-access', authenticate, meetingAccessLimiter, async (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' });
    const result = await meetingSdk.sdkAccess(req.params.id, req.userId);
    await MeetingEvent.create({ consultationId: req.params.id, eventType: 'join_attempt', participantRole: result.role, occurredAt: new Date(), correlationId: lifecycle.correlationIdFor(req.params.id), metadata: { channel: 'sdk' } });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post('/consultations/:id/telemetry', authenticate, meetingAccessLimiter, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, { attributes: ['id', 'clientId', 'lawyerId'] });
    if (!consultation || ![consultation.clientId, consultation.lawyerId].includes(req.userId)) return res.status(403).json({ error: 'Нет доступа' });
    const allowed = ['join_succeeded', 'join_failed', 'reconnect_started', 'reconnect_succeeded', 'reconnect_failed', 'meeting_completed'];
    if (!allowed.includes(req.body.event)) return res.status(400).json({ error: 'Некорректное событие' });
    await MeetingEvent.create({
      consultationId: consultation.id, eventType: req.body.event,
      participantRole: req.userId === consultation.lawyerId ? 'lawyer' : 'client', occurredAt: new Date(),
      correlationId: lifecycle.correlationIdFor(consultation.id),
      metadata: { provider: 'zoom', quality: ['good', 'fair', 'poor'].includes(req.body.quality) ? req.body.quality : undefined },
    });
    return res.status(202).json({ accepted: true });
  } catch (error) { return next(error); }
});

module.exports = router;

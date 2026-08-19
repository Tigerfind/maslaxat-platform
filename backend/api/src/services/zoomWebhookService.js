const crypto = require('crypto');
const { ConsultationMeeting, ZoomConnection, ZoomWebhookEvent } = require('../models');
const zoomConnectionService = require('./zoomConnectionService');

function verify(rawBody, timestamp, signature) {
  if (!process.env.ZOOM_WEBHOOK_SECRET) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function handle(req, res) {
  const raw = req.body.toString('utf8');
  if (!verify(raw, req.get('x-zm-request-timestamp'), req.get('x-zm-signature'))) return res.status(401).json({ error: 'Invalid Zoom signature' });
  const payload = JSON.parse(raw);
  if (payload.event === 'endpoint.url_validation') {
    const plainToken = payload.payload?.plainToken;
    const encryptedToken = crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET).update(plainToken).digest('hex');
    return res.json({ plainToken, encryptedToken });
  }
  const requestId = req.get('x-zm-request-id');
  if (!requestId) return res.status(400).json({ error: 'Missing Zoom request id' });
  const minimalPayload = {
    accountId: payload.payload?.account_id || payload.payload?.accountId || null,
    meetingId: payload.payload?.object?.id ? String(payload.payload.object.id) : null,
    eventTimestamp: payload.event_ts || null,
  };
  const [webhookEvent, created] = await ZoomWebhookEvent.findOrCreate({
    where: { requestId },
    defaults: { event: payload.event || 'unknown', payload: minimalPayload, status: 'processing', processedAt: null },
  });
  if (!created) {
    if (webhookEvent.status === 'processed') return res.status(204).end();
    const stale = Date.now() - new Date(webhookEvent.updatedAt).getTime() > 5 * 60 * 1000;
    if (webhookEvent.status === 'processing' && !stale) return res.status(409).json({ error: 'Event is already processing' });
    await webhookEvent.update({ status: 'processing', event: payload.event || 'unknown', payload: minimalPayload, processedAt: null });
  }

  try {
    const meetingId = minimalPayload.meetingId;
    if (meetingId) {
      const meeting = await ConsultationMeeting.findOne({ where: { externalMeetingId: meetingId } });
      if (meeting && payload.event === 'meeting.started' && !['ended', 'cancelled'].includes(meeting.status)) {
        await meeting.update({ status: 'started', startedAt: new Date() });
      }
      if (meeting && payload.event === 'meeting.ended') {
        if (meeting.status !== 'cancelled') await meeting.update({ status: 'ended', endedAt: new Date() });
      }
    }

    if (payload.event === 'app_deauthorized' && minimalPayload.accountId) {
      const connections = await ZoomConnection.findAll({ where: { zoomAccountId: minimalPayload.accountId, status: 'connected' }, attributes: ['userId'] });
      await Promise.all(connections.map(({ userId }) => zoomConnectionService.disconnect(userId, {
        revokeRemote: false,
        reason: 'app_deauthorized',
        allowFallback: true,
      })));
    }
    await webhookEvent.update({ status: 'processed', processedAt: new Date() });
    return res.status(204).end();
  } catch (error) {
    await webhookEvent.update({ status: 'failed', processedAt: null }).catch(() => {});
    throw error;
  }
}

module.exports = { verify, handle };

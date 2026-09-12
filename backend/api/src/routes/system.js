const router = require('express').Router();
const { loadTurnConfig } = require('../config/env');

const configured = (value) => Boolean(value && !String(value).includes('CHANGE_ME'));

router.get('/capabilities', (req, res) => {
  const turn = loadTurnConfig(process.env);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    ai: configured(process.env.ANTHROPIC_API_KEY),
    email: configured(process.env.SMTP_HOST),
    payments: configured(process.env.PAYME_KEY) && configured(process.env.PAYME_MERCHANT_ID),
    turn: Boolean(turn),
    zoomMeetingSdk: process.env.ZOOM_MEETING_SDK_ENABLED === '1'
      && configured(process.env.ZOOM_CLIENT_ID) && configured(process.env.ZOOM_CLIENT_SECRET)
      && configured(process.env.ZOOM_WEBHOOK_SECRET) && configured(process.env.MEETING_PARTICIPANT_SECRET),
    support: {
      tickets: true,
      email: configured(process.env.SUPPORT_EMAIL) ? process.env.SUPPORT_EMAIL : null,
      phone: configured(process.env.SUPPORT_PHONE) ? process.env.SUPPORT_PHONE : null,
    },
  });
});

router.get('/time', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ serverNow: new Date().toISOString(), epochMs: Date.now() });
});

module.exports = router;

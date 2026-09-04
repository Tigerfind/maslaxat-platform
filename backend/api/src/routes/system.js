const router = require('express').Router();

const configured = (value) => Boolean(value && !String(value).includes('CHANGE_ME'));

router.get('/capabilities', (req, res) => {
  const turnUrl = process.env.TURN_URLS || process.env.TURN_URL;
  const turnAuth = process.env.TURN_SECRET
    || (process.env.TURN_ALLOW_STATIC === '1' && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    ai: configured(process.env.ANTHROPIC_API_KEY),
    email: configured(process.env.SMTP_HOST),
    payments: configured(process.env.PAYME_KEY) && configured(process.env.PAYME_MERCHANT_ID),
    consultationExtensions: process.env.NODE_ENV !== 'production' && !process.env.PAYME_KEY,
    turn: configured(turnUrl) && configured(turnAuth),
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

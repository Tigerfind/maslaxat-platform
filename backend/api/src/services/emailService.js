const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const { loadEmailConfig } = require('../config/env');

const MAIL_FIELDS = Object.freeze(['to', 'subject', 'html']);

function createEmailService({ env = process.env, nodemailer: mailer = nodemailer, logger: log = logger } = {}) {
  const config = loadEmailConfig(env);
  const { frontendUrl, production, smtp } = config;
  let transporter;

  async function getTransporter() {
    if (transporter) return transporter;
    if (smtp) {
      const transportConfig = {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        disableFileAccess: true,
        disableUrlAccess: true,
      };
      if (!smtp.secure && smtp.requireTLS) transportConfig.requireTLS = true;
      transporter = mailer.createTransport(transportConfig);
      log.info('Email transport initialized');
      return transporter;
    }

    const testAccount = await mailer.createTestAccount();
    transporter = mailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    log.info('Email test transport initialized');
    return transporter;
  }

  async function sendMail(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.keys(message).some((name) => !MAIL_FIELDS.includes(name))
      || MAIL_FIELDS.some((name) => typeof message[name] !== 'string' || !message[name])) {
      throw new TypeError('Email requires exactly to, subject, and html string fields');
    }
    if (production && !smtp) {
      log.warn('Email skipped because SMTP is not configured');
      return { skipped: true, reason: 'smtp_not_configured' };
    }

    const transport = await getTransporter();
    return transport.sendMail({
      from: smtp?.from || '"MaslaXat" <noreply@maslaxat.uz>',
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
  }

  async function sendPasswordResetEmail(email, token) {
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    return sendMail({
      to: email,
      subject: 'Сброс пароля — MaslaXat',
      html: `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #2D2D2D;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 24px; font-weight: 300; letter-spacing: 0.2em; color: #B8956E; text-transform: uppercase; margin: 0;">MaslaXat</h1>
        </div>
        <h2 style="font-size: 18px; font-weight: 400; margin-bottom: 16px;">Сброс пароля</h2>
        <p style="color: #6B6B6B; line-height: 1.6; margin-bottom: 24px;">
          Вы запросили сброс пароля для вашего аккаунта. Нажмите на кнопку ниже, чтобы создать новый пароль:
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="display: inline-block; background: #B8956E; color: white; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; font-size: 14px;">
            Сбросить пароль
          </a>
        </div>
        <p style="color: #9A9A9A; font-size: 13px; line-height: 1.6;">
          Ссылка действительна в течение 1 часа. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.
        </p>
        <hr style="border: none; border-top: 1px solid #E8E4DE; margin: 32px 0;" />
        <p style="color: #9A9A9A; font-size: 12px; text-align: center;">
          MaslaXat — юридическая онлайн-платформа Узбекистана
        </p>
      </div>
      `,
    });
  }

  async function sendVerificationEmail(email, token) {
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

    return sendMail({
      to: email,
      subject: 'Подтвердите ваш email — MaslaXat',
      html: `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #2D2D2D;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 24px; font-weight: 300; letter-spacing: 0.2em; color: #B8956E; text-transform: uppercase; margin: 0;">MaslaXat</h1>
        </div>
        <h2 style="font-size: 18px; font-weight: 400; margin-bottom: 16px;">Подтверждение email</h2>
        <p style="color: #6B6B6B; line-height: 1.6; margin-bottom: 24px;">
          Добро пожаловать на MaslaXat! Пожалуйста, подтвердите ваш email адрес, нажав на кнопку ниже:
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background: #B8956E; color: white; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; font-size: 14px;">
            Подтвердить email
          </a>
        </div>
        <p style="color: #9A9A9A; font-size: 13px; line-height: 1.6;">
          Если вы не регистрировались на MaslaXat, просто проигнорируйте это письмо.
        </p>
        <hr style="border: none; border-top: 1px solid #E8E4DE; margin: 32px 0;" />
        <p style="color: #9A9A9A; font-size: 12px; text-align: center;">
          MaslaXat — юридическая онлайн-платформа Узбекистана
        </p>
      </div>
      `,
    });
  }

  return Object.freeze({ sendMail, sendPasswordResetEmail, sendVerificationEmail });
}

const defaultService = createEmailService();

module.exports = {
  createEmailService,
  ...defaultService,
};

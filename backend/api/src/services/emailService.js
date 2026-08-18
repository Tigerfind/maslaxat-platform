const nodemailer = require('nodemailer');
const logger = require('../config/logger');

// Create transporter — uses SMTP settings from env or falls back to Ethereal (dev)
let transporter;

const getTransporter = async () => {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Dev fallback: Ethereal test account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    logger.info('Email: using Ethereal test account', testAccount.user);
  }

  return transporter;
};

const sendMail = async ({ to, subject, html }) => {
  // В проде без настроенного SMTP не пытаемся слать через Ethereal (внешний
  // сетевой вызов, которого в проде быть не должно) — тихо пропускаем.
  if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) {
    logger.warn(`Email не отправлен (SMTP не настроен): "${subject}" → ${to}`);
    return { skipped: true };
  }
  const t = await getTransporter();
  const from = process.env.SMTP_FROM || '"MaslaXat" <noreply@maslaxat.uz>';

  const info = await t.sendMail({ from, to, subject, html });

  // In dev, log the preview URL from Ethereal
  if (!process.env.SMTP_HOST) {
    logger.info('Email preview:', nodemailer.getTestMessageUrl(info));
  }

  return info;
};

const sendPasswordResetEmail = async (email, token) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

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
};

const sendVerificationEmail = async (email, token) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

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
};

module.exports = {
  sendMail,
  sendPasswordResetEmail,
  sendVerificationEmail,
};

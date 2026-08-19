const { createEmailService } = require('../src/services/emailService');

function createDoubles() {
  const transport = { sendMail: jest.fn().mockResolvedValue({ messageId: 'message-1' }) };
  const nodemailer = {
    createTestAccount: jest.fn().mockResolvedValue({ user: 'ethereal-user', pass: 'ethereal-pass' }),
    createTransport: jest.fn(() => transport),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { transport, nodemailer, logger };
}

test('configured SMTP uses typed secure transport and exact safe message fields', async () => {
  const { transport, nodemailer, logger } = createDoubles();
  const service = createEmailService({
    env: {
      NODE_ENV: ' development ',
      FRONTEND_URL: ' https://app.maslaxat.uz/ ',
      SMTP_HOST: ' smtp.example.com ',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: ' mailer ',
      SMTP_PASS: ' smtp-secret ',
      SMTP_FROM: ' MaslaXat <noreply@maslaxat.uz> ',
    },
    nodemailer,
    logger,
  });

  await service.sendMail({ to: 'user@example.com', subject: 'Subject', html: '<p>Hello</p>' });

  expect(nodemailer.createTransport).toHaveBeenCalledWith({
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    auth: { user: 'mailer', pass: 'smtp-secret' },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  expect(transport.sendMail).toHaveBeenCalledWith({
    from: 'MaslaXat <noreply@maslaxat.uz>',
    to: 'user@example.com',
    subject: 'Subject',
    html: '<p>Hello</p>',
  });

  await service.sendPasswordResetEmail('user@example.com', 'reset-token');
  expect(transport.sendMail.mock.calls[1][0].html)
    .toContain('href="https://app.maslaxat.uz/reset-password?token=reset-token"');
});

test('requireTLS is included only for non-secure SMTP when explicitly configured', async () => {
  const { nodemailer, logger } = createDoubles();
  const service = createEmailService({
    env: {
      NODE_ENV: 'development',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_REQUIRE_TLS: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'smtp-secret',
      SMTP_FROM: 'noreply@maslaxat.uz',
    },
    nodemailer,
    logger,
  });

  await service.sendMail({ to: 'user@example.com', subject: 'Subject', html: '<p>Hello</p>' });

  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
    port: 587,
    secure: false,
    requireTLS: true,
  }));
});

test('unknown mail fields cannot reach Nodemailer', async () => {
  const { nodemailer, logger } = createDoubles();
  const service = createEmailService({ env: { NODE_ENV: 'development' }, nodemailer, logger });

  await expect(service.sendMail({
    to: 'user@example.com',
    subject: 'Subject',
    html: '<p>Hello</p>',
    raw: { path: '/etc/passwd' },
  })).rejects.toThrow(TypeError);
  expect(nodemailer.createTestAccount).not.toHaveBeenCalled();
});

test('production without SMTP skips without creating Ethereal or logging message data', async () => {
  const { nodemailer, logger } = createDoubles();
  const service = createEmailService({
    env: { NODE_ENV: ' production ', FRONTEND_URL: ' https://app.maslaxat.uz/ ' },
    nodemailer,
    logger,
  });

  await expect(service.sendMail({
    to: 'private@example.com',
    subject: 'Secret reset subject',
    html: '<p>token-value</p>',
  })).resolves.toEqual({ skipped: true, reason: 'smtp_not_configured' });

  expect(nodemailer.createTestAccount).not.toHaveBeenCalled();
  const logs = JSON.stringify(logger.mock?.calls || [logger.info.mock.calls, logger.warn.mock.calls]);
  expect(logs).not.toContain('private@example.com');
  expect(logs).not.toContain('token-value');
  expect(logs).not.toContain('Secret reset subject');
});

test('development uses injected Ethereal account without logging credentials or preview URLs', async () => {
  const { transport, nodemailer, logger } = createDoubles();
  const service = createEmailService({ env: { NODE_ENV: 'development' }, nodemailer, logger });

  await service.sendMail({ to: 'private@example.com', subject: 'Subject', html: '<p>token-value</p>' });

  expect(nodemailer.createTestAccount).toHaveBeenCalledTimes(1);
  expect(nodemailer.createTransport).toHaveBeenCalledWith({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: 'ethereal-user', pass: 'ethereal-pass' },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  expect(transport.sendMail).toHaveBeenCalledTimes(1);
  const logs = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
  expect(logs).not.toContain('ethereal-user');
  expect(logs).not.toContain('ethereal-pass');
  expect(logs).not.toContain('private@example.com');
  expect(logs).not.toContain('token-value');
  expect(logs).not.toContain('preview');
});

test('partial SMTP configuration fails before any network account creation', () => {
  const { nodemailer, logger } = createDoubles();

  expect(() => createEmailService({
    env: { NODE_ENV: 'development', SMTP_HOST: 'smtp.example.com' },
    nodemailer,
    logger,
  })).toThrow(/SMTP_/);
  expect(nodemailer.createTestAccount).not.toHaveBeenCalled();
});

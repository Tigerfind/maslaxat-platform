const fs = require('fs');
const os = require('os');
const path = require('path');

const EXPECTED_DB = 'emaslaxat_e2e';
const EXPECTED_UPLOAD_DIR = path.join(os.tmpdir(), 'emaslaxat-e2e-uploads');

function assertSafeEnvironment() {
  if (process.env.E2E_ALLOW_DB_RESET !== '1') throw new Error('E2E_ALLOW_DB_RESET=1 is required');
  if (process.env.NODE_ENV !== 'test') throw new Error('NODE_ENV must be test');
  if (process.env.DB_NAME !== EXPECTED_DB) throw new Error(`DB_NAME must be ${EXPECTED_DB}`);
  if (process.env.DATABASE_URL) throw new Error('DATABASE_URL must be empty');
  if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)) throw new Error('DB_HOST must be local');
  if (process.env.UPLOAD_DIR !== EXPECTED_UPLOAD_DIR) throw new Error('Unexpected E2E upload directory');
}

async function main() {
  assertSafeEnvironment();
  fs.rmSync(EXPECTED_UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXPECTED_UPLOAD_DIR, { recursive: true });

  const { resetDb, models } = require('../../tests/helpers');
  const {
    sequelize, User, LawyerProfile, LawyerExperience, LawyerEducation, LawyerCertificate,
    LawyerDocument, Review, Specialization, Consultation, ConsultationMeeting,
    ClientCase, CaseDeadline, DeadlineReminder, FavoriteLawyer, Message,
  } = models;
  await resetDb();

  await Specialization.bulkCreate([
    { name: 'Гражданское право', nameUz: 'Fuqarolik huquqi', nameEn: 'Civil Law', icon: 'Gavel', lawyerCount: 1 },
    { name: 'Семейное право', nameUz: 'Oila huquqi', nameEn: 'Family Law', icon: 'FamilyRestroom', lawyerCount: 0 },
  ]);

  const client = await User.create({
    email: 'client.e2e@maslaxat.uz', password: 'E2eClient123!', name: 'E2E Client',
    phone: '+998900000001', role: 'client', isVerified: true, isActive: true,
    legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
  });
  const lawyer = await User.create({
    email: 'lawyer.e2e@maslaxat.uz', password: 'E2eLawyer123!', name: 'E2E Lawyer',
    phone: '+998900000002', role: 'lawyer', isVerified: true, isActive: true,
    legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
  });
  const profile = await LawyerProfile.create({
    userId: lawyer.id, specialization: 'Гражданское право', specializations: ['Гражданское право'],
    description: 'Тестовый юрист Playwright с заполненным профилем для проверки каталога и бронирования.',
    professionalTitle: 'Адвокат по гражданскому праву', location: 'Ташкент', region: 'Ташкент',
    licenseNumber: 'E2E-LICENSE', licenseIssuer: 'Палата адвокатов', licenseIssuedAt: '2020-01-01',
    timezone: 'Asia/Tashkent', consultationFormats: ['chat', 'audio', 'webrtc'], consultationDurations: [30, 60, 90],
    experience: 10, price: 100000,
    schedule: { mon: { enabled: true, from: '09:00', to: '18:00' } },
    isAvailable: true, verificationStatus: 'approved', balance: 300000, pendingBalance: 0,
  });
  await Promise.all([
    LawyerExperience.create({ userId: lawyer.id, organization: 'E2E Legal', position: 'Адвокат', startDate: '2020-01-01', isCurrent: true, description: 'Представительство клиентов в гражданских спорах.', displayOrder: 0 }),
    LawyerEducation.create({ userId: lawyer.id, university: 'ТГЮУ', specialty: 'Юриспруденция', degree: 'Магистр', startYear: 2014, endYear: 2020, city: 'Ташкент', country: 'Узбекистан', displayOrder: 0 }),
    LawyerCertificate.create({ userId: lawyer.id, title: 'Медиация', organization: 'Центр медиации', issuedAt: '2024-04-01', credentialUrl: 'https://example.com/e2e-credential', displayOrder: 0 }),
    LawyerDocument.create({ userId: lawyer.id, type: 'license', name: 'e2e-license.pdf', path: '/tmp/e2e-license.pdf', mimeType: 'application/pdf', size: 100, verifiedAt: new Date() }),
  ]);
  const refundLawyer = await User.create({
    email: 'refund-lawyer.e2e@maslaxat.uz', password: 'E2eRefund123!', name: 'E2E Refund Lawyer',
    role: 'lawyer', isVerified: true, isActive: true,
    legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
  });
  await LawyerProfile.create({
    userId: refundLawyer.id, specialization: 'Гражданское право', specializations: ['Гражданское право'],
    description: 'Изолированный профиль для E2E возврата.', experience: 5, price: 120000,
    schedule: {}, isAvailable: false, verificationStatus: 'approved', balance: 0, pendingBalance: 0,
  });
  const clientCase = await ClientCase.create({ clientId: client.id, title: 'Спор по договору', description: 'Тестовое дело для клиентского кабинета', status: 'in_progress' });
  const deadline = await CaseDeadline.create({ clientCaseId: clientCase.id, title: 'Подать документы', dueAt: new Date(Date.now() + 3 * 86400000), timezone: 'Asia/Tashkent', priority: 'high', source: 'manual' });
  await DeadlineReminder.create({ deadlineId: deadline.id, channel: 'in_app', intervalMinutes: 60, remindAt: new Date(deadline.dueAt.getTime() - 3600000), nextAttemptAt: new Date(deadline.dueAt.getTime() - 3600000), idempotencyKey: `${deadline.id}:in_app:60` });
  await FavoriteLawyer.create({ clientId: client.id, lawyerId: lawyer.id });
  const videoStartsAt = new Date(Date.now() + 5 * 60 * 1000);
  await Consultation.bulkCreate([
    {
      id: '11111111-1111-4111-8111-111111111111',
      clientId: client.id, lawyerId: lawyer.id, type: 'chat', status: 'accepted',
      question: 'E2E text chat', duration: 60, price: 0, isFree: true, billingStatus: 'none',
      legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'accepted', lifecycleStatus: 'ready',
      question: 'E2E Zoom lobby', duration: 30, price: 0, isFree: true, billingStatus: 'none',
      scheduledStartAt: videoStartsAt, scheduledEndAt: new Date(videoStartsAt.getTime() + 30 * 60 * 1000),
      scheduleTimezone: 'Asia/Tashkent', legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'accepted',
      question: 'E2E video call', duration: 60, price: 0, isFree: true, billingStatus: 'none',
      scheduledStartAt: videoStartsAt,
      scheduledEndAt: new Date(videoStartsAt.getTime() + 60 * 60 * 1000),
      scheduleTimezone: 'Asia/Tashkent',
      legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      clientId: client.id, lawyerId: refundLawyer.id, type: 'video', status: 'payment_pending',
      question: 'E2E refund fixture', duration: 60, price: 120000, isFree: false, billingStatus: 'none',
      legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      clientId: client.id, lawyerId: lawyer.id, clientCaseId: clientCase.id, type: 'chat', status: 'completed',
      question: 'E2E reviewed consultation', duration: 60, price: 100000, isFree: false, billingStatus: 'released',
      legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      clientId: client.id, lawyerId: lawyer.id, type: 'chat', status: 'completed',
      question: 'E2E second reviewed consultation', duration: 60, price: 100000, isFree: false, billingStatus: 'released',
      legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
    },
  ]);
  await Review.bulkCreate([
    { clientId: client.id, lawyerId: lawyer.id, consultationId: '55555555-5555-4555-8555-555555555555', rating: 5, text: 'Полезная и понятная консультация', helpfulCount: 2 },
    { clientId: client.id, lawyerId: lawyer.id, consultationId: '66666666-6666-4666-8666-666666666666', rating: 4, text: 'Хорошая консультация', helpfulCount: 1 },
  ]);
  await Message.create({ consultationId: '55555555-5555-4555-8555-555555555555', senderId: lawyer.id, text: 'Документы по делу готовы к проверке', isRead: false });
  await profile.update({ rating: 4.5, reviewsCount: 2, completedCases: 2 });
  const secretBox = require('../services/secretBox');
  const zoomMeeting = await ConsultationMeeting.create({ consultationId: '44444444-4444-4444-8444-444444444444', provider: 'zoom', externalMeetingId: '123456789', status: 'ready', scheduledAt: videoStartsAt, duration: 30 });
  await zoomMeeting.update({
    joinUrlEncrypted: secretBox.encrypt('https://zoom.us/j/123456789', `meeting:${zoomMeeting.id}:join`),
    passcodeEncrypted: secretBox.encrypt('test', `meeting:${zoomMeeting.id}:passcode`),
  });
  await User.create({
    email: 'admin.e2e@maslaxat.uz', password: 'E2eAdmin123!', name: 'E2E Admin',
    role: 'admin', isVerified: true, isActive: true,
    legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
  });

  await sequelize.close();
  console.log('E2E database prepared');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`E2E preparation failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { assertSafeEnvironment, main };

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
  const { sequelize, User, LawyerProfile, Specialization, Consultation } = models;
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
  await LawyerProfile.create({
    userId: lawyer.id, specialization: 'Гражданское право', specializations: ['Гражданское право'],
    description: 'Тестовый юрист Playwright с заполненным профилем для проверки каталога и бронирования.',
    professionalTitle: 'Адвокат по гражданскому праву', location: 'Ташкент', region: 'Ташкент',
    licenseNumber: 'E2E-LICENSE', licenseIssuer: 'Палата адвокатов', licenseIssuedAt: '2020-01-01',
    timezone: 'Asia/Tashkent', consultationFormats: ['chat', 'audio', 'webrtc'], consultationDurations: [30, 60, 90],
    experience: 10, price: 100000,
    schedule: { mon: { enabled: true, from: '09:00', to: '18:00' } },
    isAvailable: true, verificationStatus: 'approved', balance: 300000, pendingBalance: 0,
  });
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
  const videoStartsAt = new Date(Date.now() + 5 * 60 * 1000);
  await Consultation.bulkCreate([
    {
      id: '11111111-1111-4111-8111-111111111111',
      clientId: client.id, lawyerId: lawyer.id, type: 'chat', status: 'accepted',
      question: 'E2E text chat', duration: 60, price: 0, isFree: true, billingStatus: 'none',
      legalAcceptedAt: new Date(), legalVersion: '2026-08-13',
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
  ]);
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

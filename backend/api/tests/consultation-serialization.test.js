jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const {
  resetDb,
  tokenFor,
  makeMember,
  makeApprovedOperator,
  models,
} = require('./helpers');

const { Consultation } = models;
const auth = (user, mode) => ({
  Authorization: `Bearer ${tokenFor(user, 'mfa')}`,
  'X-Maslaxat-Mode': mode,
});
const forbidden = /lawyerNote|commissionRateBps|grossAmountTiyin|lawyerNetAmountTiyin|balance|pendingBalance|rejectionReason|profileSources|verifiedSnapshot|operatingStatus|promotionPilotEnabled|reminderSent|callStartedAt|chargedAt/;

beforeEach(resetDb);

test('consultation DTO hides financial/profile internals and exposes a private note only to its lawyer', async () => {
  const client = await makeMember('consultation-dto-client@test.uz');
  const { user: lawyer, lp } = await makeApprovedOperator('consultation-dto-lawyer@test.uz');
  await lawyer.update({ twoFactorEnabled: true });
  await lp.update({
    balance: 999,
    pendingBalance: 50,
    rejectionReason: 'private rejection',
    profileSources: { headline: { verificationLevel: 'self_reported', importId: 'private-import' } },
    verifiedSnapshot: { headline: 'private snapshot' },
    headline: 'Public headline',
  });
  const consultation = await Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    question: 'Serialization boundary',
    status: 'accepted',
    price: 1000,
    lawyerNote: 'lawyer-private-note',
    reminderSent: true,
    billingStatus: 'charged',
    commissionRateBps: 1500,
    grossAmountTiyin: 100000,
    lawyerNetAmountTiyin: 85000,
  });

  const clientDetail = await request(app)
    .get(`/api/consultations/${consultation.id}`)
    .set(auth(client, 'client'));
  const clientList = await request(app).get('/api/consultations').set(auth(client, 'client'));
  const lawyerDetail = await request(app)
    .get(`/api/consultations/${consultation.id}`)
    .set(auth(lawyer, 'lawyer'));

  expect(clientDetail.status).toBe(200);
  expect(clientList.status).toBe(200);
  expect(lawyerDetail.status).toBe(200);
  expect(clientDetail.body.consultation.lawyer.profile.headline).toBe('Public headline');
  expect(JSON.stringify(clientDetail.body)).not.toMatch(forbidden);
  expect(JSON.stringify(clientList.body)).not.toMatch(forbidden);
  expect(lawyerDetail.body.consultation.lawyerNote).toBe('lawyer-private-note');
  expect(JSON.stringify({ ...lawyerDetail.body.consultation, lawyerNote: undefined })).not.toMatch(forbidden);
});

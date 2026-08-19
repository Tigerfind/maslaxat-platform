const request = require('supertest');
const app = require('../src/server');
const { resetDb, makeApplicant, tokenFor } = require('./helpers');

beforeAll(resetDb, 60000);

test('manual profile update stores only a normalized HTTPS LinkedIn member URL', async () => {
  const applicant = await makeApplicant('linkedin-profile@test.uz');
  const response = await request(app)
    .put('/api/lawyer/profile')
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .field('profileRevision', String(applicant.lp.revision))
    .field('linkedinUrl', 'https://linkedin.com/in/legal-counsel/?trk=public#bio');

  expect(response.status).toBe(200);
  expect(response.body.profile.linkedinUrl).toBe('https://linkedin.com/in/legal-counsel/');
  expect(response.body.profile.revision).toBe(applicant.lp.revision + 1);
});

test('manual profile update rejects a lookalike LinkedIn host with a stable error', async () => {
  const applicant = await makeApplicant('linkedin-profile-unsafe@test.uz');
  const response = await request(app)
    .put('/api/lawyer/profile')
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .field('profileRevision', String(applicant.lp.revision))
    .field('linkedinUrl', 'https://www.linkedin.com.evil.example/in/legal-counsel');

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('INVALID_LINKEDIN_URL');
});

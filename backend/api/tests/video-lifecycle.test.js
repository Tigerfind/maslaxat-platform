const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

const { Consultation } = models;

beforeEach(resetDb);

async function fixture({ status = 'accepted', offsetMinutes = -1 } = {}) {
  const suffix = `${status}-${offsetMinutes}-${Date.now()}-${Math.random()}`;
  const client = await makeClient(`video-client-${suffix}@test.uz`);
  const outsider = await makeClient(`video-outsider-${suffix}@test.uz`);
  const { user: lawyer } = await makeLawyer(`video-lawyer-${suffix}@test.uz`);
  await lawyer.update({ twoFactorEnabled: true });
  const scheduledStartAt = new Date(Date.now() + offsetMinutes * 60000);
  const consultation = await Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    status,
    type: 'video',
    meetingProvider: 'webrtc',
    question: 'Video lifecycle regression',
    price: 0,
    isFree: true,
    scheduledStartAt,
    scheduledEndAt: new Date(scheduledStartAt.getTime() + 60 * 60000),
  });
  return { client, outsider, lawyer, consultation };
}

const clientAuth = (user) => ({
  Authorization: `Bearer ${tokenFor(user)}`,
  'X-Maslaxat-Mode': 'client',
});

const lawyerAuth = (user) => ({
  Authorization: `Bearer ${tokenFor(user, 'mfa')}`,
  'X-Maslaxat-Mode': 'lawyer',
});

function postLifecycle(id, action, headers, body) {
  return request(app)
    .post(`/api/video/consultation/${id}/${action}`)
    .set(headers)
    .send(body || {});
}

test.each([
  ['client', ({ client }) => clientAuth(client)],
  ['lawyer', ({ lawyer }) => lawyerAuth(lawyer)],
])('%s can persist the first peer connection as an in-progress call', async (_role, authFor) => {
  const state = await fixture();

  const response = await postLifecycle(state.consultation.id, 'start', authFor(state));

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: true, status: 'in_progress' });
  const persisted = await Consultation.findByPk(state.consultation.id);
  expect(persisted.status).toBe('in_progress');
  expect(persisted.callStartedAt).toBeInstanceOf(Date);
});

test('start rejects non-participants without changing the consultation', async () => {
  const state = await fixture();

  const response = await postLifecycle(
    state.consultation.id,
    'start',
    clientAuth(state.outsider),
  );

  expect(response.status).toBe(403);
  const persisted = await Consultation.findByPk(state.consultation.id);
  expect(persisted.status).toBe('accepted');
  expect(persisted.callStartedAt).toBeNull();
});

test.each([
  ['pending', -1, 400, 'INVALID_VIDEO_STATUS'],
  ['accepted', 60, 403, 'TOO_EARLY'],
  ['accepted', -240, 403, 'WINDOW_CLOSED'],
])('start rejects %s consultation at offset %i', async (status, offsetMinutes, expectedStatus, code) => {
  const state = await fixture({ status, offsetMinutes });

  const response = await postLifecycle(
    state.consultation.id,
    'start',
    clientAuth(state.client),
  );

  expect(response.status).toBe(expectedStatus);
  expect(response.body.code).toBe(code);
  const persisted = await Consultation.findByPk(state.consultation.id);
  expect(persisted.status).toBe(status);
  expect(persisted.callStartedAt).toBeNull();
});

test('parallel and repeated starts are idempotent and set callStartedAt once', async () => {
  const state = await fixture();

  const responses = await Promise.all([
    postLifecycle(state.consultation.id, 'start', clientAuth(state.client)),
    postLifecycle(state.consultation.id, 'start', lawyerAuth(state.lawyer)),
  ]);

  expect(responses.map(({ status }) => status)).toEqual([200, 200]);
  const firstStartedAt = (await Consultation.findByPk(state.consultation.id)).callStartedAt;
  const repeated = await postLifecycle(state.consultation.id, 'start', clientAuth(state.client));
  expect(repeated.status).toBe(200);
  const persisted = await Consultation.findByPk(state.consultation.id);
  expect(persisted.status).toBe('in_progress');
  expect(persisted.callStartedAt.getTime()).toBe(firstStartedAt.getTime());
});

test('end remains participant-only and is idempotent after client completion', async () => {
  const state = await fixture();
  await postLifecycle(state.consultation.id, 'start', clientAuth(state.client));

  const denied = await postLifecycle(
    state.consultation.id,
    'end',
    clientAuth(state.outsider),
    { durationSeconds: 30 },
  );
  expect(denied.status).toBe(403);

  const first = await postLifecycle(
    state.consultation.id,
    'end',
    clientAuth(state.client),
    { durationSeconds: 30 },
  );
  const repeated = await postLifecycle(
    state.consultation.id,
    'end',
    clientAuth(state.client),
    { durationSeconds: 90 },
  );

  expect(first.status).toBe(200);
  expect(repeated.status).toBe(200);
  expect(repeated.body).toMatchObject({ success: true, status: 'completed' });
  const persisted = await Consultation.findByPk(state.consultation.id);
  expect(persisted.status).toBe('completed');
  expect(persisted.actualDuration).toBe(30);
});

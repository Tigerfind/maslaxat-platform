test('production migration refusal prevents every downstream startup action', async () => {
  const { runStartup } = require('../src/startup');
  const events = [];
  const migrationError = Object.assign(new Error('pending'), { code: 'MIGRATIONS_PENDING' });

  await runStartup({
    initializeDatabase: async () => {
      events.push('database');
      throw migrationError;
    },
    authorize: async () => events.push('authorization'),
    seed: async () => events.push('seed'),
    connectRedis: async () => events.push('redis'),
    attachRedisAdapter: async () => events.push('adapter'),
    listen: async () => events.push('listen'),
    startJobs: async () => events.push('jobs'),
    onFatal: async (error) => events.push(`fatal:${error.code}`),
  });

  expect(events).toEqual(['database', 'fatal:MIGRATIONS_PENDING']);
});

test('capability cutover refusal happens after migration assertion and before every side effect', async () => {
  const { runStartup } = require('../src/startup');
  const events = [];
  const refusal = Object.assign(new Error('invalid evidence'), { code: 'AUTHORIZATION_CUTOVER_REFUSED' });

  await runStartup({
    initializeDatabase: async () => { events.push('database'); return { migrationHead: 'head' }; },
    authorize: async () => { events.push('authorization'); throw refusal; },
    seed: async () => events.push('seed'),
    connectRedis: async () => events.push('redis'),
    attachRedisAdapter: async () => events.push('adapter'),
    listen: async () => events.push('listen'),
    startJobs: async () => events.push('jobs'),
    onFatal: async (error) => events.push(`fatal:${error.code}`),
  });

  expect(events).toEqual(['database', 'authorization', 'fatal:AUTHORIZATION_CUTOVER_REFUSED']);
});

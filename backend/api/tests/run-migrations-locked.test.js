const EventEmitter = require('events');

function loadRunner() {
  return require('../src/scripts/runMigrationsLocked');
}

const gateOptions = {
  prepareBackupGate: () => ({}),
  verifyBackupTarget: async () => {},
};

function childThatExits(code, delay = 0, activity) {
  const child = new EventEmitter();
  child.kill = jest.fn((signal) => child.emit('exit', null, signal));
  process.nextTick(() => {
    activity?.enter();
    setTimeout(() => {
      activity?.leave();
      child.emit('exit', code, null);
    }, delay);
  });
  return child;
}

test('two attempts hold one advisory session lock across the complete child migration', async () => {
  const { runLockedMigrations } = loadRunner();
  let owner = null;
  let nextId = 0;
  let active = 0;
  let maximumActive = 0;
  const activity = {
    enter() { active += 1; maximumActive = Math.max(maximumActive, active); },
    leave() { active -= 1; },
  };

  class FakeClient {
    constructor() { this.id = ++nextId; }
    async connect() {}
    async end() {}
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) {
        if (owner === null) owner = this.id;
        return { rows: [{ acquired: owner === this.id }] };
      }
      if (sql.includes('pg_advisory_unlock') && owner === this.id) owner = null;
      return { rows: [{ released: true }] };
    }
  }

  const options = {
    ...gateOptions,
    Client: FakeClient,
    spawn: () => childThatExits(0, 15, activity),
    waitMs: 1000,
    pollMs: 1,
    signalBus: new EventEmitter(),
  };
  const results = await Promise.all([runLockedMigrations(options), runLockedMigrations(options)]);

  expect(results).toEqual([0, 0]);
  expect(maximumActive).toBe(1);
  expect(owner).toBeNull();
});

test('migration failure is returned and the advisory lock is released', async () => {
  const { runLockedMigrations } = loadRunner();
  const queries = [];
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql) {
      queries.push(sql);
      return { rows: [{ acquired: true, released: true }] };
    }
  }

  await expect(runLockedMigrations({
    ...gateOptions,
    Client: FakeClient,
    spawn: () => childThatExits(23),
    signalBus: new EventEmitter(),
  })).resolves.toBe(23);
  expect(queries.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true);
});

test('termination is forwarded to the child and still releases the lock', async () => {
  const { runLockedMigrations } = loadRunner();
  const signalBus = new EventEmitter();
  const queries = [];
  const child = new EventEmitter();
  child.kill = jest.fn((signal) => child.emit('exit', null, signal));
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql) {
      queries.push(sql);
      return { rows: [{ acquired: true, released: true }] };
    }
  }

  const running = runLockedMigrations({ ...gateOptions, Client: FakeClient, spawn: () => child, signalBus });
  await new Promise((resolve) => setImmediate(resolve));
  signalBus.emit('SIGTERM');

  await expect(running).resolves.toBe(143);
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  expect(queries.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true);
});

test('database session closes even when explicit advisory unlock fails', async () => {
  const { runLockedMigrations } = loadRunner();
  let ended = false;
  class FakeClient {
    async connect() {}
    async end() { ended = true; }
    async query(sql) {
      if (sql.includes('pg_advisory_unlock')) throw new Error('unlock failed');
      return { rows: [{ acquired: true }] };
    }
  }

  await expect(runLockedMigrations({
    ...gateOptions,
    Client: FakeClient,
    spawn: () => childThatExits(0),
    signalBus: new EventEmitter(),
  })).rejects.toThrow('unlock failed');
  expect(ended).toBe(true);
});

test('predeploy prepares evidence before connecting and verifies the live target under lock before spawn', async () => {
  const { runLockedMigrations } = loadRunner();
  const events = [];
  class FakeClient {
    async connect() { events.push('connect'); }
    async end() { events.push('end'); }
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) {
        events.push('lock');
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes('pg_advisory_unlock')) events.push('unlock');
      return { rows: [{ released: true }] };
    }
  }
  await expect(runLockedMigrations({
    Client: FakeClient,
    prepareBackupGate: () => { events.push('prepare'); return { signed: true }; },
    verifyBackupTarget: async (_client, prepared) => {
      expect(prepared).toEqual({ signed: true });
      events.push('verify-live-target');
    },
    spawn: () => { events.push('spawn'); return childThatExits(0); },
    signalBus: new EventEmitter(),
  })).resolves.toBe(0);
  expect(events).toEqual(['prepare', 'connect', 'lock', 'verify-live-target', 'spawn', 'unlock', 'end']);
});

test('live target verification failure releases the lock without spawning migrations', async () => {
  const { runLockedMigrations } = loadRunner();
  const spawn = jest.fn();
  let released = false;
  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('pg_advisory_unlock')) released = true;
      return { rows: [{ released: true }] };
    }
  }
  await expect(runLockedMigrations({
    Client: FakeClient,
    prepareBackupGate: () => ({}),
    verifyBackupTarget: async () => { throw new Error('migration target cluster does not match signed backup'); },
    spawn,
    signalBus: new EventEmitter(),
  })).rejects.toThrow(/cluster does not match/i);
  expect(spawn).not.toHaveBeenCalled();
  expect(released).toBe(true);
});

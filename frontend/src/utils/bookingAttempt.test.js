import {
  canonicalBookingFingerprint,
  clearBookingAttempt,
  getOrCreateBookingAttempt,
} from './bookingAttempt';

function memoryStorage({ failWrites = false } = {}) {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('storage unavailable');
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
}

const terms = {
  lawyerId: 'lawyer-1',
  preferredDate: '2026-09-01',
  preferredTime: '10:00',
  duration: 60,
  consultationType: 'video',
  problems: [{ text: '  Contract issue  ', categories: ['civil', 'tax'] }],
  specialization: 'civil',
  promoCode: 'SAVE10',
  useFreePromo: false,
  useSubscriptionFree: false,
};

test('same canonical terms reuse an attempt after modal close or page reload', () => {
  const storage = memoryStorage();
  const keys = ['attempt-1', 'attempt-2'];
  const keyFactory = () => keys.shift();
  const first = getOrCreateBookingAttempt({ lawyerId: 'lawyer-1', terms, storage, keyFactory });

  const afterReload = getOrCreateBookingAttempt({
    lawyerId: 'lawyer-1',
    terms: { ...terms, problems: [{ text: 'Contract issue', categories: ['civil', 'tax'] }] },
    storage,
    keyFactory,
  });

  expect(afterReload.key).toBe(first.key);
  expect(afterReload.fingerprint).toBe(first.fingerprint);
  expect(keys).toEqual(['attempt-2']);
});

test('deliberately changed immutable terms rotate the attempt key', () => {
  const storage = memoryStorage();
  const keys = ['attempt-1', 'attempt-2'];
  const keyFactory = () => keys.shift();
  getOrCreateBookingAttempt({ lawyerId: 'lawyer-1', terms, storage, keyFactory });

  const changed = getOrCreateBookingAttempt({
    lawyerId: 'lawyer-1',
    terms: { ...terms, preferredTime: '11:00' },
    storage,
    keyFactory,
  });

  expect(changed.key).toBe('attempt-2');
  expect(changed.fingerprint).not.toBe(canonicalBookingFingerprint(terms));
});

test('terminal clearing rotates the next otherwise-identical attempt', () => {
  const storage = memoryStorage();
  const keys = ['attempt-1', 'attempt-2'];
  const keyFactory = () => keys.shift();
  getOrCreateBookingAttempt({ lawyerId: 'lawyer-1', terms, storage, keyFactory });
  clearBookingAttempt({ lawyerId: 'lawyer-1', storage });

  const next = getOrCreateBookingAttempt({ lawyerId: 'lawyer-1', terms, storage, keyFactory });

  expect(next.key).toBe('attempt-2');
});

test('storage failures retain the attempt in the safe in-memory fallback', () => {
  const storage = memoryStorage({ failWrites: true });
  const keys = ['fallback-1', 'fallback-2'];
  const keyFactory = () => keys.shift();
  const first = getOrCreateBookingAttempt({ lawyerId: 'fallback-lawyer', terms, storage, keyFactory });
  const second = getOrCreateBookingAttempt({ lawyerId: 'fallback-lawyer', terms, storage, keyFactory });

  expect(second.key).toBe(first.key);
  expect(keys).toEqual(['fallback-2']);
});

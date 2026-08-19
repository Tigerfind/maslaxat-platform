const storageFallbacks = new WeakMap();
const globalFallback = new Map();
const PREFIX = 'booking:attempt:v1:';

const cleanString = (value) => String(value || '').trim();

export function canonicalBookingFingerprint(terms = {}) {
  const problems = (Array.isArray(terms.problems) ? terms.problems : [])
    .map((problem) => ({
      text: cleanString(problem?.text),
      categories: (Array.isArray(problem?.categories) ? problem.categories : [])
        .map(cleanString)
        .filter(Boolean),
    }))
    .filter((problem) => problem.text);
  return JSON.stringify({
    version: 1,
    lawyerId: cleanString(terms.lawyerId),
    preferredDate: cleanString(terms.preferredDate),
    preferredTime: cleanString(terms.preferredTime),
    duration: Number(terms.duration || 60),
    consultationType: cleanString(terms.consultationType || terms.type || 'video'),
    problems,
    specialization: cleanString(terms.specialization || problems[0]?.categories?.[0]),
    promoCode: cleanString(terms.promoCode).toUpperCase(),
    useFreePromo: terms.useFreePromo === true,
    useSubscriptionFree: terms.useSubscriptionFree === true,
  });
}

function stores(explicitStorage) {
  if (explicitStorage) return [explicitStorage];
  if (typeof window === 'undefined') return [];
  return [window.localStorage, window.sessionStorage].filter(Boolean);
}

function storageKey(lawyerId) {
  return `${PREFIX}${cleanString(lawyerId)}`;
}

function fallbackFor(availableStores) {
  const owner = availableStores[0];
  if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) return globalFallback;
  if (!storageFallbacks.has(owner)) storageFallbacks.set(owner, new Map());
  return storageFallbacks.get(owner);
}

function readAttempt(key, availableStores) {
  for (const storage of availableStores) {
    try {
      const value = storage.getItem(key);
      if (value) return JSON.parse(value);
    } catch (error) { /* try the next safe store */ }
  }
  return fallbackFor(availableStores).get(key) || null;
}

function writeAttempt(key, attempt, availableStores) {
  const serialized = JSON.stringify(attempt);
  let persisted = false;
  for (const storage of availableStores) {
    try {
      storage.setItem(key, serialized);
      persisted = true;
      break;
    } catch (error) { /* try the next safe store */ }
  }
  fallbackFor(availableStores).set(key, attempt);
  return persisted;
}

function defaultKeyFactory() {
  return window.crypto?.randomUUID?.()
    || `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateBookingAttempt({
  lawyerId,
  terms,
  storage,
  keyFactory = defaultKeyFactory,
  now = () => new Date(),
}) {
  const key = storageKey(lawyerId);
  const availableStores = stores(storage);
  const fingerprint = canonicalBookingFingerprint({ ...terms, lawyerId });
  const existing = readAttempt(key, availableStores);
  if (existing?.key && existing.fingerprint === fingerprint) return existing;

  const attempt = {
    key: keyFactory(),
    fingerprint,
    createdAt: now().toISOString(),
  };
  writeAttempt(key, attempt, availableStores);
  return attempt;
}

export function clearBookingAttempt({ lawyerId, storage }) {
  const key = storageKey(lawyerId);
  for (const target of stores(storage)) {
    try { target.removeItem(key); } catch (error) { /* memory fallback is still cleared */ }
  }
  fallbackFor(stores(storage)).delete(key);
}

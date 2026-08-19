let epoch = 0;
let accessors = {
  getSnapshot: () => ({}),
  chooseMode: () => null,
  reconcile: () => Promise.resolve(),
  onUnauthorized: () => undefined,
  unbindPush: () => Promise.resolve(),
  rebindPush: () => Promise.resolve(false),
  purgeCaches: undefined,
};
const sockets = new Set();
const requests = new Set();
const cacheClearers = new Set();
let cleanupFlight;
let cleanupOwner;
let unauthorizedFlight;
let sessionChannel;
const SESSION_CHANNEL = 'maslaxat-session';
const SESSION_EVENT_KEY = 'maslaxatSessionEvent';

export const configureSessionRuntime = (next) => {
  accessors = { ...accessors, ...next };
};

export const registerPrivateCacheClearer = (clear) => {
  cacheClearers.add(clear);
  return () => cacheClearers.delete(clear);
};

export const registerSessionSocket = (socket) => {
  sockets.add(socket);
  return () => sockets.delete(socket);
};

export const beginSessionRequest = (existingSignal) => {
  if (existingSignal || typeof AbortController === 'undefined') {
    return { epoch, signal: existingSignal, release: () => undefined };
  }
  const controller = new AbortController();
  requests.add(controller);
  return {
    epoch,
    signal: controller.signal,
    release: () => requests.delete(controller),
  };
};

export const rotateSessionEpoch = () => {
  epoch += 1;
  requests.forEach((controller) => {
    try { controller.abort(); } catch (error) { /* cleanup continues */ }
  });
  requests.clear();
  sockets.forEach((socket) => {
    try { socket.disconnect(); } catch (error) { /* cleanup continues */ }
  });
  sockets.clear();
  cacheClearers.forEach((clear) => {
    try { clear(); } catch (error) { /* cleanup continues */ }
  });
  return epoch;
};

export const getSessionEpoch = () => epoch;

const captureOwner = () => {
  const snapshot = accessors.getSnapshot();
  return {
    token: snapshot.token || null,
    userId: snapshot.user?.id || null,
    epoch,
  };
};

const ownerMatches = (owner, expectedEpoch = owner?.epoch) => {
  if (!owner) return false;
  const snapshot = accessors.getSnapshot();
  return snapshot.token === owner.token && epoch === expectedEpoch;
};

const purgeMaslaxatCaches = async () => {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'PURGE_CACHES' });
  } catch (error) { /* direct Cache API cleanup still runs */ }
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.allSettled(names
    .filter((name) => name.startsWith('maslaxat-'))
    .map((name) => caches.delete(name)));
};

export const cleanupSession = (owner = captureOwner(), isCurrent = () => ownerMatches(owner)) => {
  if (cleanupFlight) {
    if (cleanupOwner?.token === owner.token && cleanupOwner?.epoch === owner.epoch) return cleanupFlight;
    return cleanupFlight.then(() => cleanupSession(owner, isCurrent));
  }
  cleanupOwner = owner;
  cleanupFlight = (async () => {
    await Promise.allSettled([Promise.resolve().then(() => accessors.unbindPush(owner))]);
    const owned = isCurrent();
    const cleanupEpoch = owned ? rotateSessionEpoch() : getSessionEpoch();
    await Promise.allSettled([
      Promise.resolve().then(() => (accessors.purgeCaches || purgeMaslaxatCaches)()),
    ]);
    return { owned, epoch: cleanupEpoch };
  })().finally(() => {
    cleanupFlight = undefined;
    cleanupOwner = undefined;
  });
  return cleanupFlight;
};

export const publishSessionEvent = (type) => {
  const event = { type };
  if (typeof BroadcastChannel !== 'undefined') {
    if (!sessionChannel) sessionChannel = new BroadcastChannel(SESSION_CHANNEL);
    sessionChannel.postMessage(event);
    return;
  }
  try {
    window.localStorage.setItem(SESSION_EVENT_KEY, JSON.stringify({ ...event, nonce: Date.now() }));
    window.localStorage.removeItem(SESSION_EVENT_KEY);
  } catch (error) { /* cross-tab delivery is best effort */ }
};

export const subscribeSessionEvents = (listener) => {
  const handleStorage = (event) => {
    if (event.key !== SESSION_EVENT_KEY || !event.newValue) return;
    try { listener(JSON.parse(event.newValue)); } catch (error) { /* ignore malformed events */ }
  };
  if (typeof BroadcastChannel !== 'undefined') {
    if (!sessionChannel) sessionChannel = new BroadcastChannel(SESSION_CHANNEL);
    sessionChannel.onmessage = (event) => listener(event.data);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }
  return () => {
    if (sessionChannel) {
      sessionChannel.close();
      sessionChannel = undefined;
    }
    if (typeof window !== 'undefined') window.removeEventListener('storage', handleStorage);
  };
};

const handleUnauthorized = () => {
  if (unauthorizedFlight) return unauthorizedFlight;
  unauthorizedFlight = Promise.resolve()
    .then(() => accessors.onUnauthorized())
    .catch(() => undefined)
    .finally(() => { unauthorizedFlight = undefined; });
  return unauthorizedFlight;
};

export const sessionRuntime = {
  getSnapshot: () => accessors.getSnapshot(),
  chooseMode: () => accessors.chooseMode(accessors.getSnapshot()),
  getEpoch: () => epoch,
  beginRequest: beginSessionRequest,
  reconcile: () => accessors.reconcile(),
  onUnauthorized: handleUnauthorized,
  captureOwner,
  isOwner: ownerMatches,
  rebindPush: (owner = captureOwner(), isCurrent = () => ownerMatches(owner)) => {
    if (!isCurrent()) return Promise.resolve(false);
    return Promise.resolve().then(() => accessors.rebindPush(owner)).catch(() => false);
  },
};

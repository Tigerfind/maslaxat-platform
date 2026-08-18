const socketsByUser = new Map();
const lastSeenByUser = new Map();
const roleByUser = new Map();
const MAX_LAST_SEEN_ENTRIES = 10000;

const socketUserId = (socket) => socket.data?.userId || socket.userId;

function registerSocket(socket) {
  const userId = socketUserId(socket);
  if (!userId) return false;
  const sockets = socketsByUser.get(userId) || new Set();
  const becameOnline = sockets.size === 0;
  sockets.add(socket.id);
  socketsByUser.set(userId, sockets);
  if (socket.data?.userRole || socket.userRole) roleByUser.set(userId, socket.data?.userRole || socket.userRole);
  if (becameOnline) lastSeenByUser.delete(userId);
  return becameOnline;
}

function unregisterSocket(socket) {
  const userId = socketUserId(socket);
  const sockets = userId ? socketsByUser.get(userId) : null;
  if (!sockets) return null;
  sockets.delete(socket.id);
  if (sockets.size > 0) return null;
  socketsByUser.delete(userId);
  roleByUser.delete(userId);
  const lastSeenAt = new Date().toISOString();
  if (lastSeenByUser.size >= MAX_LAST_SEEN_ENTRIES) {
    lastSeenByUser.delete(lastSeenByUser.keys().next().value);
  }
  lastSeenByUser.set(userId, lastSeenAt);
  return { userId, role: socket.data?.userRole || socket.userRole, online: false, lastSeenAt, observedAt: lastSeenAt };
}

function getOnlineUserIds(role) {
  return [...socketsByUser.keys()].filter((userId) => !role || roleByUser.get(userId) === role);
}

function getPresence(userId) {
  const online = socketsByUser.has(userId);
  return {
    online,
    lastSeenAt: online ? null : (lastSeenByUser.get(userId) || null),
    observedAt: new Date().toISOString(),
  };
}

async function getSnapshot(role) {
  const observedAt = new Date().toISOString();
  let onlineUserIds = getOnlineUserIds(role);
  let degraded = false;
  let lastSeenSnapshot = new Map(lastSeenByUser);
  const { isRedisAdapterAttached } = require('../socket/redisAdapter');
  if (isRedisAdapterAttached()) {
    const { getIO } = require('../socket/io');
    const io = getIO();
    if (io) {
      try {
        const sockets = await io.fetchSockets();
        onlineUserIds = [...new Set(sockets
          .filter((socket) => socket.data?.publicPresence && (!role || socket.data?.userRole === role))
          .map((socket) => socket.data.userId))];
        lastSeenSnapshot = new Map();
      } catch (error) {
        onlineUserIds = [];
        lastSeenSnapshot = new Map();
        degraded = true;
      }
    }
  }
  return {
    onlineUserIds,
    lastSeenByUser: lastSeenSnapshot,
    observedAt,
    degraded,
  };
}

function getPresenceFromSnapshot(userId, snapshot) {
  const online = snapshot.degraded ? null : snapshot.onlineUserIds.includes(userId);
  return {
    online,
    lastSeenAt: online ? null : (snapshot.lastSeenByUser.get(userId) || null),
    observedAt: snapshot.observedAt,
  };
}

function resetForTests() {
  socketsByUser.clear();
  lastSeenByUser.clear();
  roleByUser.clear();
}

module.exports = {
  registerSocket,
  unregisterSocket,
  getOnlineUserIds,
  getPresence,
  getSnapshot,
  getPresenceFromSnapshot,
  resetForTests,
};

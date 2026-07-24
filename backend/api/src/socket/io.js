/**
 * Небольшой реестр Socket.io, чтобы роуты/сервисы могли слать события
 * конкретному пользователю без прямой зависимости от server.js.
 * Каждый сокет при подключении входит в персональную комнату `user:<id>`.
 */
let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

// Отправить событие всем сокетам пользователя (открытые вкладки/устройства)
function emitToUser(userId, event, payload) {
  if (!ioInstance || !userId) return;
  try {
    ioInstance.to(`user:${userId}`).emit(event, payload);
  } catch (err) {
    // сокет не критичен — не роняем основной флоу
  }
}

module.exports = { setIO, getIO, emitToUser };

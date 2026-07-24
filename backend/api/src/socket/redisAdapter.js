const { createAdapter } = require('@socket.io/redis-adapter');
const { getRedis } = require('../config/redis');
const logger = require('../config/logger');

/**
 * Подключает Redis-адаптер к Socket.io — нужен, чтобы события (уведомления, чат)
 * доходили до пользователя, даже если его сокет живёт на ДРУГОМ инстансе бэкенда.
 * По умолчанию ВЫКЛЮЧЕН (одиночный инстанс работает и без него).
 * Включается флагом SOCKET_REDIS=1 при наличии живого Redis. Ошибки не роняют сервер.
 */
async function attachRedisAdapter(io) {
  if (process.env.SOCKET_REDIS !== '1') return false;

  const pubClient = getRedis();
  if (!pubClient) {
    logger.warn('[Socket] SOCKET_REDIS=1, но Redis недоступен — адаптер не подключён');
    return false;
  }

  try {
    const subClient = pubClient.duplicate();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('[Socket] Redis-адаптер подключён (горизонтальное масштабирование)');
    return true;
  } catch (err) {
    logger.error('[Socket] Не удалось подключить Redis-адаптер', { error: err.message });
    return false;
  }
}

module.exports = { attachRedisAdapter };

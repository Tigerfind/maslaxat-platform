const jwt = require('jsonwebtoken');
const { sequelize, User, LawyerProfile, Consultation, Message } = require('../models');
const logger = require('../config/logger');
const { deriveCapabilities, evaluateAuthorizationDecision } = require('../middleware/auth');
const { getAuthorizationMode, recordAuthorizationDecision } = require('../services/authorizationRuntime');
const { passwordStateFor } = require('../services/authChallengeService');
const { reportCaughtException } = require('../instrument');
const { BoundedTtlLru, assertSocketTokenCurrent, createSocketEventGate } = require('./guards');

const SOCKET_CAPABILITY = { client: 'client', lawyer: 'lawyer', admin: 'admin' };
const SOCKET_LEGACY_ROLES = {
  client: ['client', 'lawyer'],
  lawyer: ['lawyer'],
  admin: ['admin'],
};
const CONSULTATION_AUTH_ATTRIBUTES = Object.freeze(['id', 'clientId', 'lawyerId', 'status', 'type']);

function projectConsultation(row) {
  if (!row) return null;
  const value = row.toJSON ? row.toJSON() : row;
  return Object.fromEntries(CONSULTATION_AUTH_ATTRIBUTES.map((field) => [field, value[field]]));
}

async function defaultWithLockedConsultation(id, operation) {
  return sequelize.transaction(async (transaction) => {
    const row = await Consultation.findByPk(id, {
      attributes: CONSULTATION_AUTH_ATTRIBUTES,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    return operation(projectConsultation(row), transaction);
  });
}

function ownsConsultationPerspective(socket, consultation) {
  if (socket.accountMode === 'client') return consultation.clientId === socket.userId;
  if (socket.accountMode === 'lawyer') return consultation.lawyerId === socket.userId;
  return false;
}

function socketPasswordStateMatches(decoded, user) {
  if (decoded.passwordState !== undefined) {
    return String(decoded.passwordState) === passwordStateFor(user);
  }
  return !user.passwordChangedAt || Boolean(decoded.iat
    && decoded.iat * 1000 >= new Date(user.passwordChangedAt).getTime());
}

async function loadCurrentSocketAuthorization(socket, { allowDefaultMode = false, eventName = 'event' } = {}) {
  const token = socket.handshake.auth?.token;
  if (!token) throw new Error('Authentication required');
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.twofa) throw new Error('Invalid token');

  const user = await User.findByPk(decoded.id, {
    include: [{ model: LawyerProfile, as: 'profile', required: false }],
  });
  if (!user || !user.isActive || !socketPasswordStateMatches(decoded, user)) {
    throw new Error('Invalid token');
  }

  const authLevel = decoded.authLevel === 'mfa' ? 'mfa' : 'primary';
  if (authLevel === 'mfa' && (!Number.isInteger(decoded.twoFactorVersion)
    || decoded.twoFactorVersion !== user.twoFactorVersion)) {
    throw new Error('Invalid token');
  }

  const capabilities = deriveCapabilities(user, user.profile || null, authLevel);
  const availableModes = Object.entries(SOCKET_CAPABILITY)
    .filter(([, capability]) => capabilities.includes(capability))
    .map(([name]) => name);
  const requestedMode = socket.accountMode || socket.handshake.auth?.mode;
  if (allowDefaultMode && requestedMode === undefined && availableModes.length > 1) {
    throw new Error('MODE_REQUIRED');
  }
  const accountMode = requestedMode === undefined ? availableModes[0] : requestedMode;
  const legacyAllowed = Boolean(SOCKET_LEGACY_ROLES[accountMode]?.includes(user.role));
  const capabilityAllowed = Boolean(SOCKET_CAPABILITY[accountMode]
    && capabilities.includes(SOCKET_CAPABILITY[accountMode]));
  if (!accountMode) throw new Error('MODE_FORBIDDEN');
  let decision;
  try {
    decision = await evaluateAuthorizationDecision({
      authorizationMode: getAuthorizationMode(),
      channel: 'socket',
      surface: eventName === 'handshake' ? 'SOCKET handshake' : `SOCKET ${eventName}`,
      mode: accountMode,
      legacyAllowed,
      capabilityAllowed,
      recordDecision: recordAuthorizationDecision,
    });
  } catch (_error) {
    throw new Error('AUTHORIZATION_TELEMETRY_UNAVAILABLE');
  }
  if (!decision.allowed) throw new Error('MODE_FORBIDDEN');

  return { user, capabilities, accountMode, legacyAllowed, capabilityAllowed };
}

/**
 * WebRTC Signaling Server
 * Handles peer-to-peer connection setup for video consultations.
 * Each consultation room allows exactly 2 participants (client + lawyer).
 */
function initSignaling(io, {
  reportException = reportCaughtException,
  authorizeSocket = loadCurrentSocketAuthorization,
  verifySocketToken = assertSocketTokenCurrent,
  loadConsultation = (...args) => Consultation.findByPk(...args),
  loadCurrentConsultation = (id) => defaultWithLockedConsultation(id, async (row) => row),
  withLockedConsultation = defaultWithLockedConsultation,
  createMessage = (...args) => Message.create(...args),
  loadMessage = (...args) => Message.findByPk(...args),
} = {}) {
  const consultationCache = new BoundedTtlLru({ maxEntries: 2000, ttlMs: 3000 });
  const findConsultation = async (id) => {
    const cached = consultationCache.get(id);
    if (cached) return cached;
    const row = await loadConsultation(id, { attributes: CONSULTATION_AUTH_ATTRIBUTES });
    return consultationCache.set(id, projectConsultation(row));
  };
  // Authenticate socket connections via JWT
  io.use(async (socket, next) => {
    try {
      verifySocketToken(socket.handshake.auth?.token);
      const { user, capabilities, accountMode } = await authorizeSocket(socket, {
        allowDefaultMode: true,
        eventName: 'handshake',
      });

      socket.userId = user.id;
      socket.userName = user.name;
      socket.userRole = accountMode;
      socket.userAvatar = user.avatar;
      socket.accountMode = accountMode;
      socket.capabilities = capabilities;
      next();
    } catch (err) {
      const safeMessage = ['Authentication required', 'MODE_REQUIRED', 'MODE_FORBIDDEN', 'AUTHORIZATION_TELEMETRY_UNAVAILABLE'].includes(err.message)
        ? err.message
        : 'Invalid token';
      next(new Error(safeMessage));
    }
  });

  io.on('connection', (socket) => {
    logger.debug('socket_connected', { userId: socket.userId, mode: socket.userRole });

    const reportSocketFailure = (error, event, context = {}) => {
      reportException(error, {
        operation: 'socket_event',
        event,
        ...context,
        userId: socket.userId,
      });
      logger.error('socket_event_failed', { event, ...context, userId: socket.userId });
    };
    const onSafe = (event, handler) => {
      socket.on(event, (...incoming) => {
        const ack = typeof incoming.at(-1) === 'function' ? incoming.pop() : null;
        if (!incoming.length) incoming.push(undefined);
        const rawPayload = incoming[0];
        let consultationId;
        try {
          const descriptor = rawPayload && typeof rawPayload === 'object'
            ? Object.getOwnPropertyDescriptor(rawPayload, 'consultationId')
            : null;
          if (typeof descriptor?.value === 'string' && descriptor.value.length <= 128) {
            consultationId = descriptor.value;
          }
        } catch (_error) {
          consultationId = undefined;
        }
        return Promise.resolve()
          .then(() => handler(...incoming))
          .catch((error) => {
            reportSocketFailure(error, event, consultationId ? { consultationId } : {});
            socket.emit('socket:error', { event, code: 'SOCKET_EVENT_FAILED' });
            ack?.({ ok: false, error: { code: 'SOCKET_EVENT_FAILED' } });
            return undefined;
          });
      });
    };

    // Персональная комната для realtime-уведомлений этого пользователя
    if (socket.userId) socket.join(`user:${socket.userId}`);

    const authorizeCurrent = async (eventName) => {
      try {
        const current = await authorizeSocket(socket, { eventName });
        socket.userName = current.user.name;
        socket.userAvatar = current.user.avatar;
        socket.capabilities = current.capabilities;
        return true;
      } catch (_error) {
        socket.emit('auth-error', { code: 'SOCKET_AUTH_REVOKED' });
        if (typeof socket.disconnect === 'function') socket.disconnect(true);
        return false;
      }
    };
    const revalidate = createSocketEventGate({
      socket,
      verifyToken: verifySocketToken,
      authorize: authorizeCurrent,
    });
    const ownsCurrentVideoRoom = async () => {
      if (!socket.roomId || !socket.consultationId
        || socket.roomId !== `consultation:${socket.consultationId}`
        || !socket.rooms.has(socket.roomId)) return false;
      const consultation = await findConsultation(socket.consultationId);
      return Boolean(consultation && ownsConsultationPerspective(socket, consultation));
    };

    // Join a consultation video room
    onSafe('join-room', async (rawPayload) => {
      let consultationId;
      try {
        const payload = await revalidate('join-room', rawPayload);
        if (!payload) return;
        ({ consultationId } = payload);
        // Verify user is participant of this consultation
        consultationCache.delete(consultationId);
        const consultation = projectConsultation(await loadCurrentConsultation(consultationId));
        if (!consultation) {
          return socket.emit('error', { message: 'Consultation not found' });
        }

        const isParticipant = ownsConsultationPerspective(socket, consultation);

        if (!isParticipant) {
          return socket.emit('error', { message: 'Access denied' });
        }

        const roomId = `consultation:${consultationId}`;
        socket.join(roomId);
        socket.consultationId = consultationId;
        socket.roomId = roomId;

        // Get existing users in room
        const roomSockets = await io.in(roomId).fetchSockets();
        const usersInRoom = roomSockets
          .filter((s) => s.id !== socket.id)
          .map((s) => ({
            socketId: s.id,
            userId: s.userId,
            userName: s.userName,
            userRole: s.userRole,
            userAvatar: s.userAvatar,
          }));

        // Tell the new user who's already in the room
        socket.emit('room-users', { users: usersInRoom });

        // Tell existing users about the new participant
        socket.to(roomId).emit('user-joined', {
          socketId: socket.id,
          userId: socket.userId,
          userName: socket.userName,
          userRole: socket.userRole,
          userAvatar: socket.userAvatar,
        });

        logger.debug('socket_room_joined', {
          consultationId,
          userId: socket.userId,
          participantCount: roomSockets.length,
        });
      } catch (err) {
        throw err;
      }
    });

    // Relay WebRTC signaling data between peers — только участнику ТОЙ ЖЕ комнаты
    // (раньше релеили на любой socketId; теперь проверяем принадлежность к комнате).
    onSafe('signal', async (rawPayload) => {
      const payload = await revalidate('signal', rawPayload);
      if (!payload) return;
      const { to, signal } = payload;
      if (!to || !await ownsCurrentVideoRoom()) return;
      const roomSockets = await io.in(socket.roomId).fetchSockets();
      const target = roomSockets.find((candidate) => candidate.id === to);
      if (!target || !target.rooms.has(socket.roomId)) return;
      io.to(to).emit('signal', {
        from: socket.id,
        signal,
        userName: socket.userName,
        userRole: socket.userRole,
      });
    });

    // ─── CALL INVITATION (ring) ──────────────────────────────
    // Звонящий вызывает собеседника: шлём «входящий звонок» в персональную
    // комнату другой стороны (доходит на любой странице, если пользователь онлайн).
    onSafe('call-user', async (rawPayload) => {
      let consultationId;
      try {
        const safePayload = await revalidate('call-user', rawPayload);
        if (!safePayload) return;
        ({ consultationId } = safePayload);
        // Троттлинг: не чаще одного вызова раз в 3с с одного сокета (анти-спам
        // входящих/пропущенных, чтобы нельзя было завалить собеседника push/ring).
        const now = Date.now();
        if (socket._lastCallAt && now - socket._lastCallAt < 3000) return;
        socket._lastCallAt = now;

        consultationCache.delete(consultationId);
        const consultation = projectConsultation(await loadCurrentConsultation(consultationId));
        if (!consultation) return;
        const isParticipant = ownsConsultationPerspective(socket, consultation);
        if (!isParticipant) return;
        // Звонок доступен только по подтверждённой/идущей консультации
        if (!['accepted', 'in_progress'].includes(consultation.status)) {
          return socket.emit('call-error', { message: 'Звонок недоступен для этой консультации' });
        }
        const calleeId = socket.accountMode === 'client' ? consultation.lawyerId : consultation.clientId;

        const payload = {
          consultationId,
          callerId: socket.userId,
          callerName: socket.userName,
          callerAvatar: socket.userAvatar,
          callerRole: socket.userRole,
          type: consultation.type,
        };

        // Web-push собеседнику — ловит звонок даже при свёрнутой/закрытой вкладке.
        // Service Worker сам не покажет системное уведомление, если вкладка открыта
        // (тогда звонок показывает in-app модалка). Fire-and-forget, no-op без VAPID.
        const pushService = require('../services/pushService');
        pushService
          .sendToUser(calleeId, {
            title: 'Входящий звонок',
            body: `${socket.userName} звонит вам`,
            type: 'incoming_call',
            metadata: { url: `/consultations/video/${consultationId}`, consultationId },
          })
          .catch((error) => reportSocketFailure(error, 'incoming-call-push', { consultationId }));

        // Онлайн ли собеседник (socket)? Если нет — оставляем уведомление (пропущенный).
        const calleeSockets = await io.in(`user:${calleeId}`).fetchSockets();
        if (calleeSockets.length > 0) {
          io.to(`user:${calleeId}`).emit('incoming-call', payload);
          socket.emit('call-ringing', { consultationId });
        } else {
          socket.emit('call-offline', { consultationId });
          const notificationService = require('../services/notificationService');
          await notificationService.createNotification(
            calleeId,
            'consultation_started',
            'Пропущенный звонок',
            `${socket.userName} пытался связаться с вами`,
            { consultationId, missedCall: true }
          );
        }
      } catch (err) {
        throw err;
      }
    });

    // Ответ на вызов (accept/decline/cancel): адресата вычисляем на СЕРВЕРЕ по
    // консультации и проверяем участие — раньше слепо верили payload-у callerId/
    // calleeId, и любой мог слать call-accepted/declined/cancelled кому угодно.
    const relayCall = async (event, consultationId) => {
      if (!consultationId) return;
      const consultation = await findConsultation(consultationId);
      if (!consultation) return;
      if (!ownsConsultationPerspective(socket, consultation)) return;
      const otherId = socket.accountMode === 'client' ? consultation.lawyerId : consultation.clientId;
      io.to(`user:${otherId}`).emit(event, { consultationId, byUserId: socket.userId });
    };

    // Состояние медиа (микрофон/камера вкл/выкл) — реле собеседнику в комнате,
    // чтобы показать «выключил камеру/микрофон» вместо чёрного кадра.
    onSafe('media-state', async (rawPayload) => {
      const payload = await revalidate('media-state', rawPayload);
      if (!payload) return;
      const { audio, video, consultationId } = payload;
      const activeId = consultationId || socket.consultationId;
      if (socket.consultationId !== activeId || !await ownsCurrentVideoRoom()) return;
      socket.to(socket.roomId).emit('media-state', { audio: !!audio, video: !!video });
    });

    // ─── ПРОДЛЕНИЕ ПО СОГЛАСИЮ ────────────────────────────────
    // Реле внутри видео-комнаты (оба участника уже проверены в join-room):
    // один предлагает продлить, другой принимает/отклоняет.
    onSafe('extend-request', async (rawPayload) => {
      const payload = await revalidate('extend-request', rawPayload);
      if (!payload) return;
      const { minutes, proposalId } = payload;
      if (await ownsCurrentVideoRoom()) socket.to(socket.roomId).emit('extend-request', { minutes, proposalId, from: socket.userName });
    });
    onSafe('extend-accept', async (rawPayload) => {
      const payload = await revalidate('extend-accept', rawPayload);
      if (!payload) return;
      if (await ownsCurrentVideoRoom()) socket.to(socket.roomId).emit('extend-accept', {});
    });
    onSafe('extend-decline', async (rawPayload) => {
      if (!await revalidate('extend-decline', rawPayload)) return;
      if (await ownsCurrentVideoRoom()) socket.to(socket.roomId).emit('extend-decline');
    });

    // Собеседник принял вызов — сообщаем звонящему (оба идут в видео-комнату)
    onSafe('call-accept', async (rawPayload) => {
      const payload = await revalidate('call-accept', rawPayload);
      if (!payload) return;
      await relayCall('call-accepted', payload.consultationId);
    });
    // Собеседник отклонил вызов
    onSafe('call-decline', async (rawPayload) => {
      const payload = await revalidate('call-decline', rawPayload);
      if (!payload) return;
      await relayCall('call-declined', payload.consultationId);
    });
    // Звонящий отменил вызов до ответа
    onSafe('call-cancel', async (rawPayload) => {
      const payload = await revalidate('call-cancel', rawPayload);
      if (!payload) return;
      await relayCall('call-cancelled', payload.consultationId);
    });

    // ─── CHAT EVENTS ─────────────────────────────────────────
    // Join a chat room (separate from video room)
    onSafe('join-chat', async (rawPayload) => {
      let consultationId;
      try {
        const payload = await revalidate('join-chat', rawPayload);
        if (!payload) return;
        ({ consultationId } = payload);
        const consultation = await findConsultation(consultationId);
        if (!consultation) {
          return socket.emit('error', { message: 'Consultation not found' });
        }

        const isParticipant = ownsConsultationPerspective(socket, consultation);

        if (!isParticipant) {
          return socket.emit('error', { message: 'Access denied' });
        }

        const chatRoomId = `chat:${consultationId}`;
        socket.join(chatRoomId);
        socket.chatRoomId = chatRoomId;
        socket.chatConsultationId = consultationId;

        logger.debug('socket_chat_joined', { consultationId, userId: socket.userId });
      } catch (err) {
        throw err;
      }
    });

    // Send a chat message
    onSafe('send-message', async (rawPayload) => {
      let consultationId;
      try {
        const payload = await revalidate('send-message', rawPayload);
        if (!payload) return;
        const { text } = payload;
        ({ consultationId } = payload);
        if (!text || !text.trim()) return;

        const chatRoomId = `chat:${consultationId}`;
        const filteredText = text.trim()
          .replace(/(\+?998[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/g, '***')
          .replace(/(\+?\d{10,13})/g, '***')
          .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '***');
        consultationCache.delete(consultationId);
        const message = await withLockedConsultation(consultationId, async (consultation, transaction) => {
          if (!consultation || !ownsConsultationPerspective(socket, consultation)) return null;
          if (socket.chatConsultationId !== consultationId || !socket.rooms.has(chatRoomId)) return null;
          if (['completed', 'cancelled', 'rejected'].includes(consultation.status)) return null;
          return createMessage({
            consultationId,
            senderId: socket.userId,
            text: filteredText,
          }, { transaction });
        });
        consultationCache.delete(consultationId);
        if (!message) return;

        const fullMessage = await loadMessage(message.id, {
          include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'role'] }],
        });

        // Emit to everyone in the chat room (including sender for confirmation)
        io.in(chatRoomId).emit('message-received', fullMessage.toJSON());
      } catch (err) {
        throw err;
      }
    });

    // Typing indicator
    const relayTyping = async (outboundEvent, consultationId) => {
      const chatRoomId = `chat:${consultationId}`;
      if (socket.chatConsultationId !== consultationId || !socket.rooms.has(chatRoomId)) return;
      const consultation = await findConsultation(consultationId);
      if (!consultation || !ownsConsultationPerspective(socket, consultation)) return;
      socket.to(chatRoomId).emit(outboundEvent, {
        userId: socket.userId,
        ...(outboundEvent === 'user-typing' ? { userName: socket.userName } : {}),
      });
    };

    onSafe('typing', async (rawPayload) => {
      const payload = await revalidate('typing', rawPayload);
      if (!payload) return;
      await relayTyping('user-typing', payload.consultationId);
    });

    onSafe('stop-typing', async (rawPayload) => {
      const payload = await revalidate('stop-typing', rawPayload);
      if (!payload) return;
      await relayTyping('user-stop-typing', payload.consultationId);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      if (socket.roomId) {
        socket.to(socket.roomId).emit('user-left', {
          socketId: socket.id,
          userId: socket.userId,
          userName: socket.userName,
        });
        logger.debug('socket_room_left', { consultationId: socket.consultationId, userId: socket.userId });
      }
    });

    // End call (explicit)
    onSafe('end-call', async (rawPayload) => {
      if (!await revalidate('end-call', rawPayload)) return;
      if (await ownsCurrentVideoRoom()) {
        socket.to(socket.roomId).emit('call-ended', {
          userId: socket.userId,
          userName: socket.userName,
        });
        socket.leave(socket.roomId);
      }
    });
  });
}

module.exports = {
  CONSULTATION_AUTH_ATTRIBUTES,
  initSignaling,
  loadCurrentSocketAuthorization,
  projectConsultation,
};

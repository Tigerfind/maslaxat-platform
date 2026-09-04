const jwt = require('jsonwebtoken');
const { User, LawyerProfile, Consultation, Payment } = require('../models');
const logger = require('../config/logger');
const presenceService = require('../services/presenceService');
const { isRedisAdapterAttached } = require('./redisAdapter');
const { consultationAccess } = require('../services/consultationAccessService');
const consultationPolicy = require('../services/consultationPolicy');
const { normalizeClientMessageId, createIdempotentMessage } = require('../services/chatService');
const { callProviderPolicy } = require('../services/callProviderPolicy');
const { recordPeerConnected } = require('../services/webrtcEvidenceService');

const socketUserId = (candidate) => candidate?.data?.userId;
const socketRole = (candidate) => candidate?.data?.role;
const canonicalSocket = (sockets) => [...sockets].sort((left, right) => {
  const joinedDiff = Number(left.data?.callJoinedAt || 0) - Number(right.data?.callJoinedAt || 0);
  return joinedDiff || String(left.id).localeCompare(String(right.id));
})[0];
const hasUserSocket = (sockets, userId) => sockets.some((candidate) => socketUserId(candidate) === userId);

/**
 * WebRTC Signaling Server
 * Handles peer-to-peer connection setup for video consultations.
 * Each consultation room allows exactly 2 participants (client + lawyer).
 */
function initSignaling(io) {
  // Authenticate socket connections via JWT
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.twofa) return next(new Error('2FA confirmation required'));
      const user = await User.findByPk(decoded.id, {
        attributes: ['id', 'name', 'role', 'avatar', 'isActive', 'passwordChangedAt'],
        include: [{
          model: LawyerProfile,
          as: 'profile',
          attributes: ['verificationStatus'],
          required: false,
        }],
      });

      if (!user || !user.isActive) {
        return next(new Error('User not found'));
      }
      if (user.passwordChangedAt
        && Number(decoded.sv) !== new Date(user.passwordChangedAt).getTime()) {
        return next(new Error('Session expired'));
      }

      socket.data.userId = user.id;
      socket.data.role = user.role;
      socket.data.publicPresence = user.role === 'lawyer' && user.profile?.verificationStatus === 'approved';
      socket.userId = user.id;
      socket.userName = user.name;
      socket.userRole = user.role;
      socket.userAvatar = user.avatar;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`[Socket] Connected: ${socket.userName} (${socket.userRole})`);

    // Персональная комната для realtime-уведомлений этого пользователя
    if (socket.userId) socket.join(`user:${socket.userId}`);
    const becameLocallyOnline = socket.data.publicPresence && presenceService.registerSocket(socket);
    if (becameLocallyOnline) {
      const onlineUpdate = {
        userId: socket.userId,
        role: socket.userRole,
        online: true,
        lastSeenAt: null,
        observedAt: new Date().toISOString(),
      };
      if (!isRedisAdapterAttached()) {
        io.emit('presence:update', onlineUpdate);
      }
    }

    // Join a consultation video room
    socket.on('join-room', async ({ consultationId }) => {
      try {
        // Verify user is participant of this consultation
        const consultation = await Consultation.findByPk(consultationId, {
          include: [{ model: Payment, as: 'payments', separate: true, attributes: ['status', 'refundStatus'] }],
        });
        if (!consultation) {
          return socket.emit('error', { message: 'Consultation not found' });
        }

        const isParticipant =
          consultation.clientId === socket.data.userId ||
          consultation.lawyerId === socket.data.userId;

        if (!isParticipant) {
          return socket.emit('error', { message: 'Access denied', code: 'ACCESS_DENIED' });
        }
        const providerPolicy = callProviderPolicy(consultation);
        if (!providerPolicy.allowed) return socket.emit('error', { message: 'Call provider unavailable', code: providerPolicy.code });
        const access = consultationPolicy.policyDto(consultation, socket.data.role, new Date());
        if (!access.canJoin) return socket.emit('error', { message: 'Consultation access unavailable', code: access.reason, ...access });

        const roomId = `consultation:${consultationId}`;
        socket.join(roomId);
        socket.consultationId = consultationId;
        socket.roomId = roomId;
        socket.data.consultationId = consultationId;
        socket.data.callJoinedAt = Date.now();

        // Get existing users in room
        const roomSockets = await io.in(roomId).fetchSockets();
        const ownSockets = roomSockets.filter((s) => socketUserId(s) === socket.data.userId);
        const oppositeSockets = roomSockets.filter((s) => socketUserId(s)
          && socketUserId(s) !== socket.data.userId
          && socketRole(s) !== socket.data.role);
        const activeOwnSocket = canonicalSocket(ownSockets);
        const activeOppositeSocket = canonicalSocket(oppositeSockets);
        const usersInRoom = activeOwnSocket?.id === socket.id && activeOppositeSocket
          ? [activeOppositeSocket].map((s) => ({
            socketId: s.id,
            userId: socketUserId(s),
            userName: s.userName,
            userRole: socketRole(s),
            userAvatar: s.userAvatar,
          })) : [];

        // Tell the new user who's already in the room
        socket.emit('room-users', { users: usersInRoom, active: activeOwnSocket?.id === socket.id });

        // Tell existing users about the new participant
        if (activeOwnSocket?.id === socket.id && activeOppositeSocket) {
          io.to(activeOppositeSocket.id).emit('user-joined', {
            socketId: socket.id,
            userId: socket.data.userId,
            userName: socket.userName,
            userRole: socket.data.role,
            userAvatar: socket.userAvatar,
          });
        }

        logger.debug(`[Socket] ${socket.userName} joined room ${roomId} (${roomSockets.length} users)`);
      } catch (err) {
        logger.error('[Socket] join-room error', { error: err.message });
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Relay WebRTC signaling data between peers — только участнику ТОЙ ЖЕ комнаты
    // (раньше релеили на любой socketId; теперь проверяем принадлежность к комнате).
    socket.on('signal', async ({ to, signal }) => {
      if (!socket.roomId || !to) return;
      const roomSockets = await io.in(socket.roomId).fetchSockets();
      const target = roomSockets.find((candidate) => candidate.id === to);
      if (!target || socketUserId(target) === socket.data.userId || socketRole(target) === socket.data.role) return;
      io.to(to).emit('signal', {
        from: socket.id,
        signal,
        userName: socket.userName,
        userRole: socket.userRole,
      });
    });

    socket.on('peer-connected', async ({ consultationId, peerSocketId } = {}, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
      try {
        if (!consultationId || socket.consultationId !== consultationId || !socket.roomId || !peerSocketId) {
          return ack({ ok: false, code: 'INVALID_PEER_EVIDENCE' });
        }
        const consultation = await Consultation.findByPk(consultationId);
        const providerPolicy = callProviderPolicy(consultation);
        if (!providerPolicy.allowed) return ack({ ok: false, code: providerPolicy.code });
        const roomSockets = await io.in(socket.roomId).fetchSockets();
        const target = roomSockets.find((candidate) => candidate.id === peerSocketId);
        if (!target || socketUserId(target) === socket.data.userId || socketRole(target) === socket.data.role) {
          return ack({ ok: false, code: 'INVALID_PEER_EVIDENCE' });
        }
        const result = await recordPeerConnected(consultationId, socket.data.userId, {
          socketId: socket.id,
          peerSocketId,
          mode: providerPolicy.mode,
        });
        if (result.started) {
          io.in(socket.roomId).emit('billing:call-started', {
            consultationId, at: new Date(result.consultation.callStartedAt).getTime(), captureAfterMs: 5 * 60 * 1000,
          });
        }
        return ack({ ok: true, bilateral: result.bilateral, startedAt: result.consultation.callStartedAt });
      } catch (err) {
        logger.error('[Socket] peer-connected error', { error: err.message });
        return ack({ ok: false, code: err.code || 'PEER_EVIDENCE_FAILED' });
      }
    });

    // ─── CALL INVITATION (ring) ──────────────────────────────
    // Звонящий вызывает собеседника: шлём «входящий звонок» в персональную
    // комнату другой стороны (доходит на любой странице, если пользователь онлайн).
    socket.on('call-user', async ({ consultationId }) => {
      try {
        // Троттлинг: не чаще одного вызова раз в 3с с одного сокета (анти-спам
        // входящих/пропущенных, чтобы нельзя было завалить собеседника push/ring).
        const now = Date.now();
        if (socket._lastCallAt && now - socket._lastCallAt < 3000) return;
        socket._lastCallAt = now;

        const consultation = await Consultation.findByPk(consultationId);
        if (!consultation) return;
        const isParticipant =
          consultation.clientId === socket.data.userId || consultation.lawyerId === socket.data.userId;
        if (!isParticipant) return;
        const providerPolicy = callProviderPolicy(consultation);
        if (!providerPolicy.allowed) return socket.emit('call-error', { message: 'Звонок недоступен для этой консультации', code: providerPolicy.code });
        const access = consultationAccess(consultation);
        if (!access.canJoin) return socket.emit('call-error', { message: 'Звонок недоступен для этой консультации', code: access.reason, ...access });
        const calleeId =
          consultation.clientId === socket.data.userId ? consultation.lawyerId : consultation.clientId;

        const payload = {
          consultationId,
          callerId: socket.data.userId,
          callerName: socket.userName,
          callerAvatar: socket.userAvatar,
          callerRole: socket.data.role,
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
          .catch(() => {});

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
        logger.error('[Socket] call-user error', { error: err.message });
      }
    });

    // Ответ на вызов (accept/decline/cancel): адресата вычисляем на СЕРВЕРЕ по
    // консультации и проверяем участие — раньше слепо верили payload-у callerId/
    // calleeId, и любой мог слать call-accepted/declined/cancelled кому угодно.
    const relayCall = async (event, consultationId) => {
      if (!consultationId) return;
      const consultation = await Consultation.findByPk(consultationId, { attributes: ['id', 'clientId', 'lawyerId'] });
      if (!consultation) return;
      if (consultation.clientId !== socket.userId && consultation.lawyerId !== socket.userId) return;
      const otherId = consultation.clientId === socket.userId ? consultation.lawyerId : consultation.clientId;
      io.to(`user:${otherId}`).emit(event, { consultationId, byUserId: socket.userId });
    };

    // Состояние медиа (микрофон/камера вкл/выкл) — реле собеседнику в комнате,
    // чтобы показать «выключил камеру/микрофон» вместо чёрного кадра.
    socket.on('media-state', ({ audio, video }) => {
      if (socket.roomId) socket.to(socket.roomId).emit('media-state', { audio: !!audio, video: !!video });
    });

    // ─── ПРОДЛЕНИЕ ПО СОГЛАСИЮ ────────────────────────────────
    // Реле внутри видео-комнаты (оба участника уже проверены в join-room):
    // один предлагает продлить, другой принимает/отклоняет.
    socket.on('extend-request', ({ minutes }) => {
      if (socket.roomId) socket.to(socket.roomId).emit('extend-request', { minutes, from: socket.userName });
    });
    socket.on('extend-accept', (payload) => {
      if (socket.roomId) socket.to(socket.roomId).emit('extend-accept', payload || {});
    });
    socket.on('extend-decline', () => {
      if (socket.roomId) socket.to(socket.roomId).emit('extend-decline');
    });

    // Собеседник принял вызов — сообщаем звонящему (оба идут в видео-комнату)
    socket.on('call-accept', ({ consultationId }) => {
      relayCall('call-accepted', consultationId).catch((err) => logger.error('[Socket] call-accept', { error: err.message }));
    });
    // Собеседник отклонил вызов
    socket.on('call-decline', ({ consultationId }) => {
      relayCall('call-declined', consultationId).catch((err) => logger.error('[Socket] call-decline', { error: err.message }));
    });
    // Звонящий отменил вызов до ответа
    socket.on('call-cancel', ({ consultationId }) => {
      relayCall('call-cancelled', consultationId).catch((err) => logger.error('[Socket] call-cancel', { error: err.message }));
    });

    // ─── CHAT EVENTS ─────────────────────────────────────────
    // Join a chat room (separate from video room)
    socket.on('join-chat', async ({ consultationId }) => {
      try {
        const consultation = await Consultation.findByPk(consultationId);
        if (!consultation) {
          return socket.emit('error', { message: 'Consultation not found' });
        }

        const isParticipant =
          consultation.clientId === socket.userId ||
          consultation.lawyerId === socket.userId;

        if (!isParticipant) {
          return socket.emit('error', { message: 'Access denied' });
        }

        const chatRoomId = `chat:${consultationId}`;
        socket.join(chatRoomId);
        socket.chatRoomId = chatRoomId;
        socket.chatConsultationId = consultationId;

        logger.debug(`[Socket] ${socket.userName} joined chat ${chatRoomId}`);
      } catch (err) {
        logger.error('[Socket] join-chat error', { error: err.message });
      }
    });

    // Send a chat message
    socket.on('send-message', async (payload = {}, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
      try {
        const { consultationId, text } = payload;
        const clientMessageId = normalizeClientMessageId(payload.clientMessageId);
        if (!consultationId || typeof text !== 'string' || !text.trim()) {
          return ack({ ok: false, code: 'INVALID_MESSAGE', error: 'Message text is required' });
        }
        if (clientMessageId === undefined) {
          return ack({ ok: false, code: 'INVALID_CLIENT_MESSAGE_ID', error: 'Invalid message identifier' });
        }

        const consultation = await Consultation.findByPk(consultationId);
        if (!consultation) return ack({ ok: false, code: 'CONSULTATION_NOT_FOUND', error: 'Consultation not found' });

        const isParticipant =
          consultation.clientId === socket.userId ||
          consultation.lawyerId === socket.userId;
        if (!isParticipant) return ack({ ok: false, code: 'ACCESS_DENIED', error: 'Access denied' });

        if (!consultationPolicy.isWritable(consultation)) {
          return ack({ ok: false, code: 'CONSULTATION_READ_ONLY', error: 'Consultation is read-only' });
        }

        const { message: fullMessage, created } = await createIdempotentMessage({
          consultation, senderId: socket.userId, text, clientMessageId,
        });

        const chatRoomId = `chat:${consultationId}`;
        if (created) io.in(chatRoomId).emit('message-received', fullMessage.toJSON());
        return ack({ ok: true, message: fullMessage.toJSON(), duplicate: !created });
      } catch (err) {
        logger.error('[Socket] send-message error', { error: err.message });
        return ack({ ok: false, code: 'MESSAGE_SEND_FAILED', error: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', async ({ consultationId } = {}) => {
      const chatRoomId = `chat:${consultationId}`;
      if (socket.chatConsultationId !== consultationId || socket.chatRoomId !== chatRoomId) return;
      const consultation = await Consultation.findByPk(consultationId).catch(() => null);
      if (!consultationPolicy.isParticipant(consultation, socket.userId) || !consultationPolicy.isWritable(consultation)) return;
      socket.to(chatRoomId).emit('user-typing', {
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on('stop-typing', async ({ consultationId } = {}) => {
      const chatRoomId = `chat:${consultationId}`;
      if (socket.chatConsultationId !== consultationId || socket.chatRoomId !== chatRoomId) return;
      const consultation = await Consultation.findByPk(consultationId).catch(() => null);
      if (!consultationPolicy.isParticipant(consultation, socket.userId) || !consultationPolicy.isWritable(consultation)) return;
      socket.to(chatRoomId).emit('user-stop-typing', {
        userId: socket.userId,
      });
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      if (socket.roomId) {
        const remaining = await io.in(socket.roomId).fetchSockets().catch(() => []);
        const sameUserRemains = hasUserSocket(remaining, socket.data.userId);
        if (!sameUserRemains) {
          io.in(socket.roomId).emit('user-left', {
            socketId: socket.id,
            userId: socket.data.userId,
            userName: socket.userName,
          });
        }
        logger.debug(`[Socket] ${socket.userName} left room ${socket.roomId}`);
      }
      const presenceUpdate = socket.data.publicPresence ? presenceService.unregisterSocket(socket) : null;
      if (presenceUpdate && !isRedisAdapterAttached()) {
        io.emit('presence:update', presenceUpdate);
      }
    });

    // End call (explicit)
    socket.on('end-call', () => {
      if (socket.roomId) {
        socket.to(socket.roomId).emit('call-ended', {
          userId: socket.userId,
          userName: socket.userName,
        });
        socket.leave(socket.roomId);
      }
    });
  });
}

module.exports = { initSignaling, canonicalSocket, hasUserSocket };

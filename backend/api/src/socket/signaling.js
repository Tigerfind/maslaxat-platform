const jwt = require('jsonwebtoken');
const { User, Consultation, Message } = require('../models');
const logger = require('../config/logger');

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
      const user = await User.findByPk(decoded.id, {
        attributes: ['id', 'name', 'role', 'avatar', 'isActive'],
      });

      if (!user || !user.isActive) {
        return next(new Error('User not found'));
      }

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

    // Join a consultation video room
    socket.on('join-room', async ({ consultationId }) => {
      try {
        // Verify user is participant of this consultation
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

        // Биллинг (модель B): засекаем момент, когда ОБА участника в звонке — от него
        // пойдут 5 минут до захвата оплаты. Ставим один раз (атомарно, идемпотентно).
        try {
          const present = new Set(roomSockets.map((s) => s.userId));
          const bothHere = present.has(consultation.clientId) && present.has(consultation.lawyerId);
          if (bothHere && !consultation.callStartedAt) {
            const [aff] = await Consultation.update(
              { callStartedAt: new Date() },
              { where: { id: consultationId, callStartedAt: null } }
            );
            if (aff) {
              io.in(roomId).emit('billing:call-started', {
                consultationId, at: Date.now(), captureAfterMs: 5 * 60 * 1000,
              });
            }
          }
        } catch (e) {
          logger.error('[Socket] billing call-start error', { error: e.message });
        }

        logger.debug(`[Socket] ${socket.userName} joined room ${roomId} (${roomSockets.length} users)`);
      } catch (err) {
        logger.error('[Socket] join-room error', { error: err.message });
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Relay WebRTC signaling data between peers — только участнику ТОЙ ЖЕ комнаты
    // (раньше релеили на любой socketId; теперь проверяем принадлежность к комнате).
    socket.on('signal', ({ to, signal }) => {
      if (!socket.roomId || !to) return;
      const target = io.sockets.sockets.get(to);
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
          consultation.clientId === socket.userId || consultation.lawyerId === socket.userId;
        if (!isParticipant) return;
        // Звонок доступен только по подтверждённой/идущей консультации
        if (!['accepted', 'in_progress'].includes(consultation.status)) {
          return socket.emit('call-error', { message: 'Звонок недоступен для этой консультации' });
        }
        const calleeId =
          consultation.clientId === socket.userId ? consultation.lawyerId : consultation.clientId;

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
    socket.on('send-message', async ({ consultationId, text }) => {
      try {
        if (!text || !text.trim()) return;

        const consultation = await Consultation.findByPk(consultationId);
        if (!consultation) return;

        const isParticipant =
          consultation.clientId === socket.userId ||
          consultation.lawyerId === socket.userId;
        if (!isParticipant) return;

        // Завершённая консультация — только чтение, новые сообщения не принимаем
        if (['completed', 'cancelled', 'rejected'].includes(consultation.status)) return;

        // Filter out phone numbers to prevent bypassing the platform
        let filteredText = text.trim()
          .replace(/(\+?998[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/g, '***')
          .replace(/(\+?\d{10,13})/g, '***')
          .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '***');

        // Save message to DB
        const message = await Message.create({
          consultationId,
          senderId: socket.userId,
          text: filteredText,
        });

        const fullMessage = await Message.findByPk(message.id, {
          include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'role'] }],
        });

        const chatRoomId = `chat:${consultationId}`;
        // Emit to everyone in the chat room (including sender for confirmation)
        io.in(chatRoomId).emit('message-received', fullMessage.toJSON());
      } catch (err) {
        logger.error('[Socket] send-message error', { error: err.message });
      }
    });

    // Typing indicator
    socket.on('typing', ({ consultationId }) => {
      const chatRoomId = `chat:${consultationId}`;
      socket.to(chatRoomId).emit('user-typing', {
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on('stop-typing', ({ consultationId }) => {
      const chatRoomId = `chat:${consultationId}`;
      socket.to(chatRoomId).emit('user-stop-typing', {
        userId: socket.userId,
      });
    });

    // Биллинг (модель B): участник вышел РАНЬШЕ 5 минут → сбрасываем таймер, чтобы
    // списания не было. Оплата спишется, только если оба пробудут в звонке 5 минут подряд.
    async function billingOnLeave() {
      const cid = socket.consultationId;
      const room = socket.roomId;
      if (!cid) return;
      try {
        const c = await Consultation.findByPk(cid);
        if (!c || !c.callStartedAt) return;
        if (['charged', 'released'].includes(c.billingStatus)) return; // уже списано — поздно
        const elapsed = Date.now() - new Date(c.callStartedAt).getTime();
        if (elapsed < 5 * 60 * 1000) {
          await Consultation.update({ callStartedAt: null }, { where: { id: cid } });
          if (room) io.in(room).emit('billing:call-paused', { consultationId: cid });
        }
      } catch (e) {
        logger.error('[Socket] billing leave error', { error: e.message });
      }
    }

    // Handle disconnection
    socket.on('disconnect', () => {
      if (socket.roomId) {
        socket.to(socket.roomId).emit('user-left', {
          socketId: socket.id,
          userId: socket.userId,
          userName: socket.userName,
        });
        logger.debug(`[Socket] ${socket.userName} left room ${socket.roomId}`);
      }
      billingOnLeave();
    });

    // End call (explicit)
    socket.on('end-call', () => {
      if (socket.roomId) {
        socket.to(socket.roomId).emit('call-ended', {
          userId: socket.userId,
          userName: socket.userName,
        });
        billingOnLeave();
        socket.leave(socket.roomId);
      }
    });
  });
}

module.exports = { initSignaling };

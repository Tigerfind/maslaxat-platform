/**
 * Система обнаружения конфликтов и дубликатов
 * Предотвращает создание конфликтующих записей
 */

// ===== ТИПЫ КОНФЛИКТОВ =====

export const CONFLICT_TYPES = {
  DUPLICATE: 'duplicate',
  TIME_OVERLAP: 'time_overlap',
  UNIQUE_VIOLATION: 'unique_violation',
  CAPACITY_EXCEEDED: 'capacity_exceeded',
  BUSINESS_RULE: 'business_rule',
};

export const CONFLICT_SEVERITY = {
  CRITICAL: 'critical',   // Полностью блокирует операцию
  WARNING: 'warning',     // Предупреждение, можно продолжить
  INFO: 'info',          // Информационное сообщение
};

// ===== ДЕТЕКТОР ДУБЛИКАТОВ =====

/**
 * Проверка дубликата консультации
 */
export const detectDuplicateConsultation = (newRequest, existingRequests = []) => {
  const duplicates = existingRequests.filter((existing) => {
    // Проверка: тот же клиент, тот же юрист, та же дата/время
    const sameClient = existing.client?.id === newRequest.client?.id;
    const sameLawyer =
      existing.lawyerId === newRequest.lawyerId ||
      existing.lawyerName === newRequest.lawyerName;
    const sameDateTime =
      existing.preferredDate === newRequest.preferredDate &&
      existing.preferredTime === newRequest.preferredTime;

    // Дубликат только если все условия совпадают
    if (sameClient && sameLawyer && sameDateTime) {
      return true;
    }

    // Проверка на "похожий" запрос (в течение 24 часов)
    const existingTime = new Date(existing.createdAt).getTime();
    const newTime = new Date().getTime();
    const hoursDiff = (newTime - existingTime) / (1000 * 60 * 60);

    if (sameClient && sameLawyer && hoursDiff < 24 && existing.status === 'pending') {
      return true;
    }

    return false;
  });

  if (duplicates.length > 0) {
    return {
      type: CONFLICT_TYPES.DUPLICATE,
      severity: CONFLICT_SEVERITY.CRITICAL,
      message: 'У вас уже есть активный запрос к этому юристу',
      details: {
        existing: duplicates[0],
        action: 'Пожалуйста, дождитесь ответа на предыдущий запрос',
      },
    };
  }

  return null;
};

/**
 * Проверка конфликта времени юриста
 */
export const detectLawyerTimeConflict = (lawyerId, lawyerName, date, time, existingConsultations = []) => {
  const conflicts = existingConsultations.filter((consultation) => {
    // Проверка для того же юриста
    const sameLawyer =
      consultation.lawyerId === lawyerId ||
      consultation.lawyerName === lawyerName;

    if (!sameLawyer) return false;

    // Проверка той же даты
    const sameDate = consultation.preferredDate === date;

    if (!sameDate) return false;

    // Проверка конфликта времени (пересечение слотов)
    const consultationTime = parseTime(consultation.preferredTime);
    const requestedTime = parseTime(time);

    // Консультация занимает 1 час
    const consultationEnd = consultationTime + 60;
    const requestedEnd = requestedTime + 60;

    // Проверка пересечения временных слотов
    const hasOverlap =
      (requestedTime >= consultationTime && requestedTime < consultationEnd) ||
      (requestedEnd > consultationTime && requestedEnd <= consultationEnd) ||
      (requestedTime <= consultationTime && requestedEnd >= consultationEnd);

    return hasOverlap && (consultation.status === 'pending' || consultation.status === 'accepted');
  });

  if (conflicts.length > 0) {
    return {
      type: CONFLICT_TYPES.TIME_OVERLAP,
      severity: CONFLICT_SEVERITY.WARNING,
      message: 'Это время уже занято другой консультацией',
      details: {
        conflicting: conflicts,
        action: 'Выберите другое время или дождитесь подтверждения от юриста',
      },
    };
  }

  return null;
};

/**
 * Проверка уникальности email/телефона
 */
export const detectUniqueViolation = (field, value, existingRecords = []) => {
  const violation = existingRecords.find((record) => {
    if (field === 'email') {
      return record.email?.toLowerCase() === value?.toLowerCase();
    }
    if (field === 'phone') {
      return record.phone?.replace(/\D/g, '') === value?.replace(/\D/g, '');
    }
    return record[field] === value;
  });

  if (violation) {
    return {
      type: CONFLICT_TYPES.UNIQUE_VIOLATION,
      severity: CONFLICT_SEVERITY.CRITICAL,
      message: `${field === 'email' ? 'Email' : 'Телефон'} уже используется`,
      details: {
        field,
        value,
        action: `Используйте другой ${field === 'email' ? 'email' : 'номер телефона'}`,
      },
    };
  }

  return null;
};

/**
 * Проверка лимита консультаций юриста
 */
export const detectCapacityConflict = (lawyerId, date, existingConsultations = [], maxPerDay = 10) => {
  const consultationsOnDate = existingConsultations.filter((consultation) => {
    return (
      consultation.lawyerId === lawyerId &&
      consultation.preferredDate === date &&
      (consultation.status === 'pending' || consultation.status === 'accepted')
    );
  });

  if (consultationsOnDate.length >= maxPerDay) {
    return {
      type: CONFLICT_TYPES.CAPACITY_EXCEEDED,
      severity: CONFLICT_SEVERITY.CRITICAL,
      message: 'Юрист полностью занят на эту дату',
      details: {
        currentCount: consultationsOnDate.length,
        maxCapacity: maxPerDay,
        action: 'Выберите другую дату',
      },
    };
  }

  return null;
};

/**
 * Проверка бизнес-правил (минимальное время до консультации)
 */
export const detectBusinessRuleViolation = (date, time, minHoursAhead = 2, startsAt) => {
  const absolute = startsAt ? new Date(startsAt) : null;
  const requestedDateTime = absolute && !Number.isNaN(absolute.getTime()) ? absolute : new Date(`${date}T${time}`);
  const now = new Date();
  const hoursDiff = (requestedDateTime - now) / (1000 * 60 * 60);

  if (hoursDiff < minHoursAhead) {
    return {
      type: CONFLICT_TYPES.BUSINESS_RULE,
      severity: CONFLICT_SEVERITY.CRITICAL,
      message: `Консультация должна быть забронирована минимум за ${minHoursAhead} часа`,
      details: {
        requestedTime: requestedDateTime,
        minimumAdvance: minHoursAhead,
        action: 'Выберите время позже',
      },
    };
  }

  return null;
};

// ===== КОМПЛЕКСНАЯ ПРОВЕРКА =====

/**
 * Выполнить все проверки для бронирования консультации
 */
export const validateConsultationBooking = (bookingData, context = {}) => {
  const {
    existingConsultations = [],
    minHoursAhead = 2,
    maxConsultationsPerDay = 10,
  } = context;

  const conflicts = [];

  // 1. Проверка дубликатов
  const duplicate = detectDuplicateConsultation(bookingData, existingConsultations);
  if (duplicate) conflicts.push(duplicate);

  // 2. Проверка временных конфликтов
  const timeConflict = detectLawyerTimeConflict(
    bookingData.lawyerId,
    bookingData.lawyerName,
    bookingData.preferredDate,
    bookingData.preferredTime,
    existingConsultations
  );
  if (timeConflict) conflicts.push(timeConflict);

  // 3. Проверка лимита юриста
  const capacityConflict = detectCapacityConflict(
    bookingData.lawyerId,
    bookingData.preferredDate,
    existingConsultations,
    maxConsultationsPerDay
  );
  if (capacityConflict) conflicts.push(capacityConflict);

  // 4. Проверка бизнес-правил
  const businessRule = detectBusinessRuleViolation(
    bookingData.preferredDate,
    bookingData.preferredTime,
    minHoursAhead,
    bookingData.startsAt,
  );
  if (businessRule) conflicts.push(businessRule);

  // Вернуть результат
  return {
    isValid: conflicts.filter((c) => c.severity === CONFLICT_SEVERITY.CRITICAL).length === 0,
    conflicts,
    criticalConflicts: conflicts.filter((c) => c.severity === CONFLICT_SEVERITY.CRITICAL),
    warnings: conflicts.filter((c) => c.severity === CONFLICT_SEVERITY.WARNING),
    canProceed: conflicts.filter((c) => c.severity === CONFLICT_SEVERITY.CRITICAL).length === 0,
  };
};

// ===== УТИЛИТЫ =====

/**
 * Парсинг времени в минуты
 */
const parseTime = (timeString) => {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Получить человекочитаемое сообщение о конфликте
 */
export const formatConflictMessage = (validationResult) => {
  if (validationResult.isValid) {
    return null;
  }

  const { criticalConflicts, warnings } = validationResult;

  let message = '';

  if (criticalConflicts.length > 0) {
    message = criticalConflicts[0].message;
    if (criticalConflicts[0].details?.action) {
      message += `\n${criticalConflicts[0].details.action}`;
    }
  } else if (warnings.length > 0) {
    message = warnings.map((w) => w.message).join('\n');
  }

  return message;
};

/**
 * Логирование конфликтов (для отладки)
 */
export const logConflicts = (validationResult) => {
  if (import.meta.env.DEV) {
    console.group('🔍 Conflict Detection Results');
    console.log('Valid:', validationResult.isValid);
    console.log('Can Proceed:', validationResult.canProceed);

    if (validationResult.criticalConflicts.length > 0) {
      console.group('🚨 Critical Conflicts');
      validationResult.criticalConflicts.forEach((conflict, index) => {
        console.log(`${index + 1}.`, conflict);
      });
      console.groupEnd();
    }

    if (validationResult.warnings.length > 0) {
      console.group('⚠️ Warnings');
      validationResult.warnings.forEach((warning, index) => {
        console.log(`${index + 1}.`, warning);
      });
      console.groupEnd();
    }

    console.groupEnd();
  }
};

// ===== ЭКСПОРТ =====

const conflictDetector = {
  // Детекторы
  detectDuplicateConsultation,
  detectLawyerTimeConflict,
  detectUniqueViolation,
  detectCapacityConflict,
  detectBusinessRuleViolation,

  // Комплексная валидация
  validateConsultationBooking,

  // Утилиты
  formatConflictMessage,
  logConflicts,

  // Константы
  CONFLICT_TYPES,
  CONFLICT_SEVERITY,
};

export default conflictDetector;

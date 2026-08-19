const { toPublicProfile } = require('./publicLawyerDto');

const PUBLIC_FIELDS = [
  'id', 'type', 'status', 'question', 'problems', 'specialization', 'description',
  'preferredDate', 'preferredTime', 'duration', 'actualDuration', 'price',
  'isFree', 'promoCode', 'freeSource', 'billingStatus', 'createdAt', 'updatedAt',
  'clientId', 'lawyerId',
];

function basicUser(user, { lawyer = false } = {}) {
  if (!user) return undefined;
  const value = user.toJSON ? user.toJSON() : user;
  return {
    id: value.id,
    name: value.name,
    avatar: value.avatar || null,
    ...(lawyer && value.profile ? { profile: toPublicProfile(value.profile) } : {}),
  };
}

function reviewDto(review) {
  if (!review) return undefined;
  const value = review.toJSON ? review.toJSON() : review;
  return {
    id: value.id,
    rating: value.rating,
    text: value.text,
  };
}

function toConsultationDto(instance, { perspective } = {}) {
  if (!instance) return null;
  const value = instance.toJSON ? instance.toJSON() : instance;
  const dto = Object.fromEntries(PUBLIC_FIELDS
    .filter((field) => value[field] !== undefined)
    .map((field) => [field, value[field]]));

  if (value.client) dto.client = basicUser(value.client);
  if (value.lawyer) dto.lawyer = basicUser(value.lawyer, { lawyer: true });
  if (value.consultationReview) dto.consultationReview = reviewDto(value.consultationReview);
  if (perspective === 'lawyer') dto.lawyerNote = value.lawyerNote || '';
  return dto;
}

module.exports = { toConsultationDto };

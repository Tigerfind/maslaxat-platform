const consultationPolicy = require('./consultationPolicy');

function safeLawyer(user) {
  if (!user) return null;
  const profile = user.profile || null;
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar || null,
    specialization: profile?.specialization || null,
    specializations: profile?.specializations || [],
    rating: Number(profile?.rating) || 0,
    professionalTitle: profile?.professionalTitle || null,
    reviewsCount: Number(profile?.reviewsCount) || 0,
    experience: Number(profile?.experience) || 0,
    languages: profile?.languages || [],
    price: Number(profile?.price) || 0,
    isAvailable: profile?.isAvailable === true,
  };
}

function safeConsultation(row, role = 'client', now = new Date()) {
  const value = row?.toJSON ? row.toJSON() : { ...row };
  const access = consultationPolicy.policyDto(value, role, now);
  delete value.lawyerNote;
  delete value.payments;
  if (value.lawyer) value.lawyer = safeLawyer(value.lawyer);
  return { ...value, policy: access, access };
}

function safePayment(row) {
  const value = row?.toJSON ? row.toJSON() : { ...row };
  return {
    id: value.id,
    consultationId: value.consultationId,
    amount: Number(value.amount),
    currency: value.currency,
    provider: value.provider,
    status: value.status,
    transactionId: value.transactionId || null,
    refundStatus: value.refundStatus,
    refundedAt: value.refundedAt || null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    consultation: value.Consultation || value.consultation || null,
  };
}

module.exports = { safeLawyer, safeConsultation, safePayment };

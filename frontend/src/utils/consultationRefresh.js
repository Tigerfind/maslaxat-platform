export const nextJoinPolicyRefreshDelay = (consultations, serverOffset = 0, now = Date.now()) => {
  const serverNow = now + serverOffset;
  const times = (Array.isArray(consultations) ? consultations : [consultations])
    .filter(Boolean)
    .filter((item) => item.policy?.reason === 'TOO_EARLY' && item.policy?.canJoin !== true)
    .map((item) => new Date(item.policy?.joinAvailableAt).getTime())
    .filter(Number.isFinite);
  if (!times.length) return null;
  return Math.max(0, Math.min(...times) - serverNow) + 100;
};

export const joinPolicyRefreshKey = (consultation) => (
  consultation?.policy?.reason === 'TOO_EARLY' && consultation.policy?.joinAvailableAt
    ? `${consultation.id}:${consultation.policy.joinAvailableAt}` : null
);

export const isAuthoritativeUnavailableLawyerError = (error) => (
  error?.response?.status === 404 || (
    error?.response?.status === 410
    && ['LAWYER_INACTIVE', 'LAWYER_UNAVAILABLE'].includes(error?.response?.data?.code)
  )
);

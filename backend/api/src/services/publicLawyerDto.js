const PROFILE_FIELDS = [
  'specialization', 'specializations', 'description', 'headline', 'workExperience',
  'education', 'certificates', 'languages', 'experience', 'price', 'rating',
  'reviewsCount', 'completedCases', 'location', 'isAvailable', 'verificationStatus',
  'linkedinUrl',
];
const OBJECT_FIELDS = {
  workExperience: ['title', 'company', 'location', 'startDate', 'endDate', 'description'],
  education: ['institution', 'degree', 'endDate'],
  certificates: ['name', 'issuer', 'issuedAt'],
};

function plainText(value, max = 2000) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeList(value) {
  return Array.isArray(value) ? value.slice(0, 100).map((item) => plainText(item, 200)).filter(Boolean) : [];
}

function safeObjects(value, fields) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => Object.fromEntries(
    fields.map((field) => [field, plainText(item?.[field], 500)])
  ));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function safeLinkedinUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:'
      || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port
      || !/^\/in\/[^/]+\/?$/.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function publicProvenance(profile) {
  const result = {};
  for (const [field, source] of Object.entries(profile.profileSources || {})) {
    if (!PROFILE_FIELDS.includes(field)) continue;
    if (source?.verificationLevel === 'self_reported') result[field] = 'self_reported';
    if (source?.verificationLevel === 'document_checked') {
      result[field] = sameValue(profile[field], profile.verifiedSnapshot?.[field])
        ? 'document_checked'
        : 'changed_after_check';
    }
  }
  return result;
}

function toPublicProfile(profile) {
  if (!profile) return null;
  const result = {};
  for (const field of PROFILE_FIELDS) {
    const value = profile[field];
    if (OBJECT_FIELDS[field]) result[field] = safeObjects(value, OBJECT_FIELDS[field]);
    else if (['specializations', 'languages'].includes(field)) result[field] = safeList(value);
    else if (['description', 'headline', 'specialization', 'location', 'verificationStatus'].includes(field)) result[field] = plainText(value);
    else if (field === 'linkedinUrl') result[field] = safeLinkedinUrl(value);
    else result[field] = value;
  }
  result.provenance = publicProvenance(profile);
  return result;
}

function toPublicReview(instance) {
  const value = instance?.toJSON ? instance.toJSON() : instance || {};
  return {
    id: value.id,
    rating: Number(value.rating) || 0,
    text: plainText(value.text || value.comment, 2000),
    createdAt: value.createdAt,
    client: value.client ? {
      id: value.client.id,
      name: plainText(value.client.name, 200),
      avatar: typeof value.client.avatar === 'string' ? value.client.avatar : null,
    } : null,
  };
}

function toPublicLawyerDto(instance) {
  const value = instance?.toJSON ? instance.toJSON() : instance || {};
  return {
    id: value.id,
    name: plainText(value.name, 200),
    avatar: typeof value.avatar === 'string' ? value.avatar : null,
    role: value.role,
    isVerified: Boolean(value.isVerified),
    createdAt: value.createdAt,
    profile: toPublicProfile(value.profile),
    ...(Array.isArray(value.receivedReviews) ? {
      receivedReviews: value.receivedReviews
        .filter((review) => review.isHidden !== true)
        .map(toPublicReview),
    } : {}),
  };
}

module.exports = { toPublicLawyerDto, toPublicProfile, toPublicReview, plainText, safeLinkedinUrl };

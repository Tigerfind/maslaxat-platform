const crypto = require('crypto');

const cleanString = (value) => String(value || '').trim();

function buildBookingFingerprint({
  lawyerId,
  preferredDate,
  preferredTime,
  duration,
  type,
  problems,
  specialization,
  priceTiyin,
}) {
  const canonicalObject = {
    version: 1,
    lawyerId: cleanString(lawyerId),
    preferredDate: cleanString(preferredDate),
    preferredTime: cleanString(preferredTime),
    duration: Number(duration || 60),
    type: cleanString(type || 'video'),
    problems: (Array.isArray(problems) ? problems : []).map((problem) => ({
      text: cleanString(problem?.text),
      categories: (Array.isArray(problem?.categories) ? problem.categories : []).map(cleanString),
    })),
    specialization: cleanString(specialization),
    priceTiyin: Number(priceTiyin),
  };
  const canonical = JSON.stringify(canonicalObject);
  return {
    version: 1,
    canonical,
    fingerprint: crypto.createHash('sha256').update(canonical).digest('hex'),
  };
}

module.exports = { buildBookingFingerprint };

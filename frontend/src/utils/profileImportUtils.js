const PROFILE_FORM_FIELDS = [
  'headline', 'description', 'greeting', 'experience', 'price', 'location',
  'specialization', 'specializations', 'schedule', 'workExperience', 'education',
  'certificates', 'languages', 'linkedinUrl',
];

export const mergeProfileIntoForm = (previous, profile) => {
  if (!profile || typeof profile !== 'object') return previous;
  const merged = { ...previous };
  if (Number.isInteger(profile.revision)) merged.profileRevision = profile.revision;
  for (const field of PROFILE_FORM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(profile, field) && profile[field] !== undefined) {
      merged[field] = profile[field];
    }
  }
  if (!Object.prototype.hasOwnProperty.call(profile, 'specializations')
    && profile.specialization !== undefined) {
    merged.specializations = profile.specialization ? [profile.specialization] : [];
  }
  return merged;
};

const IMPORT_STATUSES = new Set(['uploaded', 'parsing', 'draft', 'confirmed', 'failed', 'expired', 'discarded']);

export const importStatusKey = (status) => (
  IMPORT_STATUSES.has(status) ? `profileImport.status_${status}` : 'profileImport.status_unknown'
);

export const safeAttachmentFilename = (value, fallback = 'linkedin-profile.pdf') => {
  const leaf = String(value || '').split(/[\\/]/).pop() || '';
  const printable = Array.from(leaf).filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join('');
  const clean = printable
    .replace(/["'<>:|?*]/g, '')
    .replace(/^\.+|[. ]+$/g, '')
    .trim();
  if (!clean) return fallback;
  return clean.slice(0, 120);
};

export const revokeObjectUrl = (value, urlApi = URL) => {
  if (typeof value === 'string' && value.startsWith('blob:')) urlApi.revokeObjectURL(value);
};

export const replaceObjectUrl = (previous, file, urlApi = URL) => {
  revokeObjectUrl(previous, urlApi);
  return urlApi.createObjectURL(file);
};

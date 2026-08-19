const PUBLIC_PROVENANCE = new Set(['self_reported', 'document_checked', 'changed_after_check']);

export const safeLinkedinProfileUrl = (value) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
      || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port
      || !/^\/in\/[^/]+\/?$/.test(url.pathname)) return null;
    return url.toString();
  } catch (_error) {
    return null;
  }
};

export const publicProvenanceLabel = (value) => (
  typeof value === 'string' && PUBLIC_PROVENANCE.has(value) ? value : null
);

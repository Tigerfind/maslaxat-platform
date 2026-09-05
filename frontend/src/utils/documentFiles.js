const DOCUMENT_FORMATS = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  txt: ['text/plain'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
};

export const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png';
export const CASE_DOCUMENT_ACCEPT = `${DOCUMENT_ACCEPT},.webp`;
export const DOCUMENT_FORMAT_LABEL = 'PDF, DOC, DOCX, TXT, JPG, PNG';
export const CASE_DOCUMENT_FORMAT_LABEL = `${DOCUMENT_FORMAT_LABEL}, WEBP`;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const getFileExtension = (name = '') => {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
};

export const isAllowedDocumentFile = (file, { allowWebp = false } = {}) => {
  const extension = getFileExtension(file?.name);
  if (extension === 'webp' && !allowWebp) return false;
  const allowedMimes = DOCUMENT_FORMATS[extension];
  if (!allowedMimes) return false;
  // iOS and some Android pickers omit MIME or return the generic binary MIME.
  if (!file.type || file.type === 'application/octet-stream') return true;
  return allowedMimes.includes(file.type);
};

export const normalizeDocumentFile = (file) => {
  if (!file || (file.type && file.type !== 'application/octet-stream')) return file;
  const mime = DOCUMENT_FORMATS[getFileExtension(file.name)]?.[0];
  return mime ? new File([file], file.name, { type: mime, lastModified: file.lastModified }) : file;
};

export const getPreviewKind = (name = '', mime = '') => {
  const extension = getFileExtension(name);
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension) && (!mime || mime === 'application/octet-stream' || mime.startsWith('image/'))) return 'image';
  if (extension === 'pdf' && (!mime || mime === 'application/octet-stream' || mime === 'application/pdf')) return 'pdf';
  return 'other';
};

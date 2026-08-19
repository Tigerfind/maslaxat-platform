'use strict';

async function streamFile({ storage, req, res, record, filename, publicCache = false, maxBytes }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort);
  res.once('close', close);
  try {
    await storage.stream({
      record,
      response: res,
      filename,
      signal: controller.signal,
      maxBytes,
      ...(publicCache ? {
        disposition: 'inline',
        cacheControl: 'public, max-age=300',
        etag: `"${record.sha256}"`,
      } : {}),
    });
  } finally {
    req.removeListener('aborted', abort);
    res.removeListener('close', close);
  }
}

module.exports = { streamFile };

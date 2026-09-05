import { describe, expect, test } from 'vitest';
import { CASE_DOCUMENT_ACCEPT, DOCUMENT_ACCEPT, getPreviewKind, isAllowedDocumentFile, normalizeDocumentFile } from './documentFiles';

describe('document file validation', () => {
  test('accepts iOS files with an allowed extension and empty or generic MIME', () => {
    expect(isAllowedDocumentFile({ name: 'claim.pdf', type: '' })).toBe(true);
    expect(isAllowedDocumentFile({ name: 'photo.JPG', type: 'application/octet-stream' })).toBe(true);
    expect(isAllowedDocumentFile({ name: 'scan.webp', type: '' })).toBe(false);
    expect(isAllowedDocumentFile({ name: 'scan.webp', type: '' }, { allowWebp: true })).toBe(true);
    expect(DOCUMENT_ACCEPT).not.toContain('.webp');
    expect(CASE_DOCUMENT_ACCEPT).toContain('.webp');
  });

  test('rejects mismatched and unsupported types', () => {
    expect(isAllowedDocumentFile({ name: 'claim.pdf', type: 'image/jpeg' })).toBe(false);
    expect(isAllowedDocumentFile({ name: 'archive.zip', type: 'application/octet-stream' })).toBe(false);
  });

  test('normalizes an empty iOS MIME to the strict backend MIME', () => {
    const file = new File(['%PDF-'], 'claim.pdf', { type: '' });
    const normalized = normalizeDocumentFile(file);
    expect(normalized.type).toBe('application/pdf');
    expect(normalized.name).toBe(file.name);
  });

  test('limits inline previews to backend-supported image types and PDF', () => {
    expect(getPreviewKind('scan.png', '')).toBe('image');
    expect(getPreviewKind('contract.pdf', 'application/octet-stream')).toBe('pdf');
    expect(getPreviewKind('animation.gif', 'image/gif')).toBe('other');
  });
});

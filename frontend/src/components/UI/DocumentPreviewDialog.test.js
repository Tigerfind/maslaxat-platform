import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { LanguageProvider } from '../../i18n';
import DocumentPreviewDialog from './DocumentPreviewDialog';

describe('DocumentPreviewDialog object URLs', () => {
  test('revokes the preview URL when unmounted', async () => {
    const createObjectURL = vi.fn(() => 'blob:preview');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const { unmount } = render(
      <LanguageProvider>
        <DocumentPreviewDialog open onClose={() => {}} name="claim.pdf" fetchBlob={() => Promise.resolve(new Blob(['%PDF-'], { type: 'application/pdf' }))} />
      </LanguageProvider>,
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});

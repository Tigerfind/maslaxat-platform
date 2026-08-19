import api from './api';
import { adminLawyerService } from './adminService';

jest.mock('./api', () => ({ get: jest.fn(), patch: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('admin source audit reads metadata and downloads the original only as an attachment blob', async () => {
  api.get.mockResolvedValueOnce({ data: { import: { id: 'import-1', originalName: 'profile.pdf', parsedData: { headline: 'private draft' } } } });
  api.get.mockResolvedValueOnce({ data: new Blob(['pdf'], { type: 'application/pdf' }) });

  const metadata = await adminLawyerService.getProfileImportSource('import-1');
  await adminLawyerService.getProfileImportAttachment('import-1');

  expect(api.get).toHaveBeenNthCalledWith(1, '/lawyer/imports/import-1');
  expect(api.get).toHaveBeenNthCalledWith(2, '/lawyer/imports/import-1/download', { responseType: 'blob' });
  expect(metadata.import).not.toHaveProperty('parsedData');
});

test('admin verifies one supported profile field with an approved supporting document', async () => {
  api.patch.mockResolvedValue({ data: { field: 'education', provenance: { verificationLevel: 'document_checked' } } });

  await adminLawyerService.verifyProfileField('lawyer-1', 'education', 'document-1');

  expect(api.patch).toHaveBeenCalledWith('/admin/lawyers/lawyer-1/profile-fields/education/verify', {
    documentId: 'document-1',
  });
});

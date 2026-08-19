import {
  importStatusKey,
  mergeProfileIntoForm,
  replaceObjectUrl,
  revokeObjectUrl,
  safeAttachmentFilename,
} from './profileImportUtils';

test('confirmed profile merge replaces imported fields and revision without overwriting unrelated form state', () => {
  const previous = {
    profileRevision: 2,
    description: 'Default text',
    headline: '',
    price: 250000,
    schedule: { mon: { enabled: true } },
    avatarFile: { name: 'avatar.png' },
    avatarPreview: 'blob:avatar',
  };
  const merged = mergeProfileIntoForm(previous, {
    revision: 7,
    description: 'Imported summary',
    headline: 'Senior counsel',
    experience: 0,
    specialization: 'Civil law',
    specializations: ['Civil law'],
    education: [{ institution: 'TSUL' }],
    workExperience: [{ title: 'Partner' }],
    certificates: [{ name: 'Bar' }],
    languages: ['ru'],
  });

  expect(merged).toMatchObject({
    profileRevision: 7,
    description: 'Imported summary',
    headline: 'Senior counsel',
    experience: 0,
    specialization: 'Civil law',
    specializations: ['Civil law'],
    education: [{ institution: 'TSUL' }],
    workExperience: [{ title: 'Partner' }],
    certificates: [{ name: 'Bar' }],
    languages: ['ru'],
    price: 250000,
    schedule: { mon: { enabled: true } },
    avatarPreview: 'blob:avatar',
  });
});

test('download filename strips paths, controls and quotes and remains bounded', () => {
  expect(safeAttachmentFilename('../../private/"profile"\u0000.pdf')).toBe('profile.pdf');
  expect(safeAttachmentFilename('x'.repeat(200) + '.pdf').length).toBeLessThanOrEqual(120);
  expect(safeAttachmentFilename('..')).toBe('linkedin-profile.pdf');
});

test('import statuses map only to localized allowlisted keys', () => {
  expect(importStatusKey('uploaded')).toBe('profileImport.status_uploaded');
  expect(importStatusKey('confirmed')).toBe('profileImport.status_confirmed');
  expect(importStatusKey('secret_internal')).toBe('profileImport.status_unknown');
});

test('object URL replacement and cleanup revoke only owned blob URLs', () => {
  const urlApi = { createObjectURL: jest.fn(() => 'blob:new'), revokeObjectURL: jest.fn() };
  expect(replaceObjectUrl('blob:old', { name: 'new.png' }, urlApi)).toBe('blob:new');
  expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:old');
  revokeObjectUrl('https://cdn.example/avatar.png', urlApi);
  expect(urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
  revokeObjectUrl('blob:new', urlApi);
  expect(urlApi.revokeObjectURL).toHaveBeenLastCalledWith('blob:new');
});

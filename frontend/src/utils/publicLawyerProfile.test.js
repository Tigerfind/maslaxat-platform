import { publicProvenanceLabel, safeLinkedinProfileUrl } from './publicLawyerProfile';

test.each([
  ['https://www.linkedin.com/in/legal-counsel', 'https://www.linkedin.com/in/legal-counsel'],
  ['https://linkedin.com/in/legal-counsel/', 'https://linkedin.com/in/legal-counsel/'],
  ['http://www.linkedin.com/in/legal-counsel', null],
  ['https://evil.example/in/legal-counsel', null],
  ['https://www.linkedin.com/company/legal', null],
  ['https://www.linkedin.com.evil.example/in/legal-counsel', null],
  ['javascript:alert(1)', null],
])('validates a LinkedIn member URL without fetching it: %s', (input, expected) => {
  expect(safeLinkedinProfileUrl(input)).toBe(expected);
});

test('maps only public provenance labels and rejects internal source objects', () => {
  expect(publicProvenanceLabel('self_reported')).toBe('self_reported');
  expect(publicProvenanceLabel('document_checked')).toBe('document_checked');
  expect(publicProvenanceLabel('changed_after_check')).toBe('changed_after_check');
  expect(publicProvenanceLabel({ importId: 'secret' })).toBeNull();
  expect(publicProvenanceLabel('admin_reviewed')).toBeNull();
});

const { toPublicLawyerDto } = require('../src/routes/lawyers');

test('public lawyer DTO allowlists plain profile fields and strips provenance internals', () => {
  const dto = toPublicLawyerDto({
    id: 'lawyer-1',
    name: '<b>Malika</b>',
    avatar: '/avatar.png',
    role: 'lawyer',
    isVerified: true,
    createdAt: new Date('2026-08-17T00:00:00.000Z'),
    password: 'secret',
    profile: {
      headline: '<img src=x onerror=alert(1)>Senior counsel',
      description: '<script>alert(1)</script>Family law',
      workExperience: [{ title: '<b>Partner</b>', company: 'Firm', location: 'Tashkent', startDate: '2020', endDate: 'Present', description: '<svg onload=alert(1)>Cases' }],
      education: [{ institution: '<i>TSUL</i>', degree: 'LLB', endDate: '2019' }],
      certificates: [{ name: '<b>Bar</b>', issuer: 'Board', issuedAt: '2021' }],
      languages: ['ru'], specializations: ['Family law'], specialization: 'Family law',
      experience: 7, location: 'Tashkent', price: 200000, rating: 4.9,
      reviewsCount: 10, completedCases: 20, verificationStatus: 'approved',
      operatingStatus: 'enabled', isAvailable: true,
      linkedinUrl: 'https://www.linkedin.com/in/malika',
      profileSources: {
        headline: { verificationLevel: 'self_reported', importId: 'import-secret' },
        education: { verificationLevel: 'document_checked', documentId: 'doc-secret', reviewedByUserId: 'admin-secret' },
        certificates: { verificationLevel: 'document_checked', documentId: 'doc-2' },
      },
      verifiedSnapshot: {
        education: [{ institution: 'Old TSUL', degree: 'LLB', endDate: '2019' }],
        certificates: [{ name: '<b>Bar</b>', issuer: 'Board', issuedAt: '2021' }],
      },
      revision: 9, rejectionReason: 'private', balance: '999', pendingBalance: '50',
      promotionPilotEnabled: true,
    },
    receivedReviews: [
      { id: 'visible', rating: 5, text: '<b>Helpful</b>', createdAt: '2026-08-17', isHidden: false, lawyerId: 'secret', client: { id: 'client-1', name: 'Client', avatar: null, email: 'private@example.uz' } },
      { id: 'hidden', rating: 1, text: 'Moderated', createdAt: '2026-08-16', isHidden: true, moderationReason: 'private', client: { id: 'client-2', name: 'Spammer' } },
    ],
  });

  expect(dto.name).toBe('Malika');
  expect(dto.profile.headline).toBe('Senior counsel');
  expect(dto.profile.description).toBe('Family law');
  expect(dto.profile.workExperience[0].title).toBe('Partner');
  expect(dto.profile.provenance).toEqual({
    headline: 'self_reported',
    education: 'changed_after_check',
    certificates: 'document_checked',
  });
  expect(dto.receivedReviews).toEqual([{
    id: 'visible', rating: 5, text: 'Helpful', createdAt: '2026-08-17',
    client: { id: 'client-1', name: 'Client', avatar: null },
  }]);
  expect(JSON.stringify(dto)).not.toMatch(/profileSources|verifiedSnapshot|import-secret|doc-secret|admin-secret|rejectionReason|balance|promotionPilot|password/);
  expect(JSON.stringify(dto)).not.toMatch(/hidden|Moderated|moderationReason|lawyerId|private@example/);
});

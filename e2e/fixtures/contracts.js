const ACTOR_NAMES = ['client', 'otherClient', 'lawyer', 'otherLawyer', 'applicant', 'importer', 'dualMember', 'mfaLawyer', 'admin'];
const RESOURCE_NAMES = [
  'consultationId', 'otherConsultationId', 'promotionId', 'refundPromotionId', 'refundPaymentId',
  'importId', 'documentId', 'applicantDocumentId', 'packageId',
];

function validateSeedState(state) {
  if (!state || typeof state.runId !== 'string' || !state.runId) throw new Error('Seed state runId is required');
  for (const name of ACTOR_NAMES) {
    const actor = state.actors?.[name];
    if (!actor?.id || !actor?.email?.endsWith('@e2e.maslaxat.invalid') || !actor?.password) {
      throw new Error(`Seed state actor ${name} is incomplete`);
    }
  }
  if (!state.actors.mfaLawyer.totpSecret || !state.actors.admin.totpSecret) {
    throw new Error('Seed state MFA actor secrets are required');
  }
  for (const name of RESOURCE_NAMES) {
    if (!state.resources?.[name]) throw new Error(`Seed state resource ${name} is required`);
  }
  return state;
}

module.exports = { ACTOR_NAMES, RESOURCE_NAMES, validateSeedState };

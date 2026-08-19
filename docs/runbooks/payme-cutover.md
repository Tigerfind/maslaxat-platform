# Payme Evidence And Cutover Runbook

## Status

This runbook prepares evidence only. Payment cutover is **external and blocked** until real Payme sandbox credentials, an approved webhook URL, representative sanitized staging reconciliation, observation evidence, independent approval, and transaction/refund smoke are available. `PAYMENT_V2_MODE=active` remains rejected by application and environment configuration.

## Roles And Keys

- `payment_owner` and `release_owner` are independently administered protected environments and
  role-specific signing keys. Evidence does not claim an unverifiable human identity.
- Use separate Ed25519 pairs for telemetry-source, payment-owner approval, release-owner approval,
  and final package signing. The two approvers and key IDs must be distinct.
- Keep every private key outside the application runtime. The final package key exists only in the
  protected `payment-staging-signing` environment, which has no database/runtime credentials.
- Store the public verification key separately as `PAYMENT_EVIDENCE_PUBLIC_KEY_B64`; verification must never receive the private key.
- Rotate the key ID and pair after suspected disclosure. Previously signed artifacts remain immutable and are not re-signed.

## Private Inputs

The approved `payment-shadow-telemetry.yml` run must upload private mode-0600 `events.jsonl`,
`stream-metadata.json`, `provider-totals.json`, and `source-attestation.signed.json`. Events contain
the stream ID, sequence, timestamp, repository scenario key, exact approved comparison fields, and
hash-chain checkpoints. They must not contain request bodies, params, authorization, IDs, amounts,
account values, raw payloads, or PII.

`provider-totals.json` contains only schema version, provider, currency, capture timestamp, aggregate paid/refunded tiyin totals, transaction count, and canonical digest. Detailed Payme exports remain in provider-controlled storage and are never CI artifacts.

## Observation Gate

Use one approved path:

1. Observe the exact shadow deployment for at least 24 hours and execute every inventory scenario, or
2. Execute the complete externally approved scenario set whose digest equals `paymentSandboxScenarios.json`.

Any sequence gap, conflicting duplicate sequence, broken first/last/checkpoint binding, unknown
scenario, producer flag contradiction, missing scenario count, unequal payload hash, outcome mismatch,
unsupported method, stale/future artifact, or release binding mismatch aborts preparation. Observation
timestamps are derived from the attested stream, never entered by an operator.

## Reconciliation Gate

Use a read-only credential for a representative sanitized staging database. The reconciler must report zero local financial mismatches across ambiguity, pending legacy states, amount, prepayment flow, paid state, provider duplicates, ledger finalization, attribution, caches, promotion subjects, unresolved/partial/full refunds, exact subscription term recognition, completed promotion service-day recognition, and fresh provider aggregate totals.

Before financial reads, the same repeatable-read, read-only transaction enforces A1's exact packaged/applied `SequelizeMeta` set and compares its actual head with the signed source attestation. The private detailed report may contain database identifiers and must never be uploaded. Only the artifact-safe summary with category counts, reconciliation timestamp, and non-secret SHA-256 database/snapshot identities plus release/provider bindings is signed and retained.

## Protected Workflow

Run `.github/workflows/payment-staging-evidence-prepare.yml` first with the successful source telemetry
run. It performs collection and one read-only reconciliation, then emits the immutable
`payment-reconciliation-proof`. Run the two protected approval workflows against that exact prepare
run. Finally run `.github/workflows/payment-staging-evidence.yml` with the successful prepare proof
run ID and both approval run IDs. Finalization never recollects or reruns time-dependent reconciliation.
Commit/deployment/service/config/migration/observation bindings come from the exact downloaded proof,
not dispatch claims. The chain:

1. The prepare workflow's `payment-staging-collection` job resolves the successful source run, verifies its
   source signature and raw artifact digests, then proves semantic compatibility and stream continuity.
2. The prepare workflow's `payment-staging-reconciliation` job alone receives the read-only database credential and
   produces an artifact-safe summary bound to actual migration head, hashed database/snapshot identity, and reconciliation time.
3. Role approval workflows sign the exact prepare proof with separate environment keys, without
   free-form person identity claims.
4. Finalization resolves the successful prepare/approval runs and consumes the exact approved proof.
5. The `payment-staging-signing` job checks out reviewed code and exposes its private key only to one
   local signing step after checkout/install/download; a trap removes the key on every exit.
6. Generates a canonical schema-v4 manifest bound to proof run, commit, deployment, service, config, actual migration head, hashed database/snapshot identity, reconciliation time, inventory, stream checkpoints, provider totals, reconciliation, and externally signed approvals.
7. Signs summary and manifest without DB/runtime credentials, deletes the private key, and verifies
   with the public key, independent expected bindings, and injected current time.
8. `payment-signed-pending-verification` is an intermediate transport artifact and is not final evidence.
9. After successful independent verification, uploads the bounded immutable
   `payment-final-verified-<run>` package containing the exact prepare-proof inputs, original signed
   telemetry source, provider totals, both signed role approvals, signed/verified summary and
   manifest bytes, SHA-256 inventory over the complete retained trust chain, and verifier result.
10. Ends at `STOP_BEFORE_PAYMENT_MODE_CHANGE` with nonzero status.

## Abort And Rollback

- Abort on any missing input, nonzero financial category, signature error, observation gap, mismatch, stale binding, absent approval, or provider discrepancy.
- Do not repair financial rows in the reconciliation workflow. Open a separately reviewed operator procedure for each discrepancy.
- Keep the deployed application in `legacy` or approved `shadow`; legacy remains authoritative.
- No workflow or runbook command changes payment mode, deploys code, invokes Payme, or modifies production data.

## External Approval Boundary

After a clean package, payment and release owners review the immutable artifacts and provider-native evidence. A separate future cutover implementation/review is required because active mode does not exist. Real sandbox transaction, duplicate callback, cancellation, provider-confirmed partial/full refund, and post-deploy smoke remain external blocked steps.

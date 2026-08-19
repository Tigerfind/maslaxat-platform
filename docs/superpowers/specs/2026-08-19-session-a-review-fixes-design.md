# Session A Review Fixes Design

## Scope

Close six Session A review findings without production access, deployment, or unrelated refactoring.
All security-sensitive paths fail closed and all tests use local fakes.

## Design

Restore container jobs use an explicit robust Bash shell contract. R2 discovery uses one reusable,
explicit ListObjectsV2 paginator that validates each JSON page, truncation state, continuation-token
progress, key shape, and duplicate keys before returning a complete inventory. Pruning and newest
committed-backup selection both consume that inventory.

The production predeploy command first runs a local signed-evidence validator and only then invokes
the advisory-locked migration wrapper. Evidence must be canonical, signed by the configured key,
fresh, successful, and bound to the effective source cluster and exact Railway release SHA. Static
evidence failures block database access; live cluster or applied-state failures block migration under
the advisory lock before the migration CLI starts.

Before `pg_dump`, backup verifies that the sorted names applied in the exported snapshot are an exact
ordered prefix of the release's sorted packaged migration filenames. Only a pending packaged suffix
is allowed. Deterministic applied and target count/digest/head identities are included in the signed
manifest and evidence. Predeploy compares the target identity to the local image, then under the
migration advisory lock compares the actual `DATABASE_URL` system identifier and applied set to the
signed source before spawning migrations. Restore verifies the signed applied snapshot set.

The snapshot holder is an explicitly controlled PostgreSQL session rather than a fixed sleep. Backup
checks its liveness throughout every snapshot-dependent operation, sends rollback after the final
assertion, waits for deterministic termination, and treats premature death as failure.

The existing small representative fixture remains responsible for edge contracts. A separate,
deterministic generated scale fixture creates at least 50 lawyers, 200 clients, and 1,000
consultations and runs in the PostgreSQL 16 representative migration lane.

## Verification

Tests cover Bash workflow execution, multi-page and malformed R2 responses, evidence signature,
freshness and identity bindings, exact migration-set mismatch/digest behavior, snapshot-holder death
without long sleeps, and generated fixture counts. Run focused Jest suites, Bash and Node syntax
checks, update Graphify, inspect the final diff, and stage only intentional files.

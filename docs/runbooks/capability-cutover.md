# Capability Authorization Cutover

## Current Ruling

`AUTHORIZATION_MODE=compatibility` is the only approved deployed state. Capability-only authority
is prepared in code but remains externally blocked. Local tests, generated fixtures, empty logs, or
an unsigned file never authorize a cutover.

Legacy `users.role` remains a mirrored rollback field for this release. There is no role-removal
migration in this wave, and no role-removal migration may be added to a rollback release.

## Compatibility Evidence

The exact repository inventory is mechanically collected from tagged guards after every Express
router alias is mounted. Its canonical SHA-256 digest binds each HTTP method plus mounted path
template, each Socket.io event from `EVENT_FIELDS`, each catalog operation, and only modes that can
reach that decision point. Tests invoke every mounted HTTP guard/mode and compare the collected set
to the signed inventory; unknown routes cannot become evidence surfaces. Every comparison is written before route/event side effects
to `authorization_evidence_events`; rows contain no user ID, request ID, role, email, phone, path,
query, payload, consultation ID, or document data.

The distributed scheduler writes one idempotent canary every five minutes. The export refuses:

- less than 24 hours of derived observation time;
- a missing canary interval, duplicate event ID, release mismatch, or event outside the window;
- zero coverage for any inventory surface/mode;
- any `legacyAllowed != capabilityAllowed` mismatch;
- a non-private source URI or source/artifact digest mismatch.
- an observation ending more than 24 hours before manifest generation or startup verification;
- missing provider-authenticated deployment metadata or mismatched GitHub workflow ref/run identity.

The staging database and artifact store must be private and retention-limited. Operators must
investigate `AUTHORIZATION_TELEMETRY_UNAVAILABLE`, `authorization_telemetry_unavailable`, and
`auth_capability_mismatch`; any occurrence aborts the window.

## Trust Separation

Use distinct Ed25519 key pairs and protected GitHub environments:

- telemetry export: `authorization-telemetry-export`, read-only evidence database access, no key;
- `security_owner`: `authorization-security-owner-approval` and its own signing key;
- `release_owner`: `authorization-release-owner-approval` and a different signing key;
- `cutover_owner`: `authorization-cutover-owner-approval` and a third explicit cutover key;
- manifest signer: `authorization-evidence-signing`, no database access;
- verifier: `authorization-evidence-verification`, public keys only.

Private signing keys must remain outside the application runtime. Public keys, key IDs, exact
release bindings, and the final private manifest path are the only runtime evidence inputs.
Approval key IDs are taken from each signed approval envelope and retained in the manifest, so key
rotation cannot be replaced by a downstream hard-coded label.

Runtime release identity is not read from `AUTHORIZATION_*` labels. The application derives commit,
deployment, and service from Railway build/provider variables, takes migration head from the A1
database assertion, and recomputes a canonical digest from the mounted inventory and authorization
constants. Preparation fetches recent provider-authenticated metadata over HTTPS, binds it to the
exact checked-out commit and trusted GitHub workflow ref/run/attempt, and refuses discrepancies.

## Evidence Procedure

1. Obtain explicit approval to deploy the reviewed commit in `compatibility` mode.
2. Record the exact commit, deployment ID, service ID, configuration digest, and migration head.
3. Exercise every inventory surface/mode through approved staging scenarios and real staging use.
4. Observe at least 24 hours with continuous five-minute canaries and zero mismatches.
5. Dispatch `authorization-evidence-prepare.yml` with exact UTC interval boundaries.
6. Inspect the private prepared artifact, validated provider/workflow provenance, and immutable raw
   source SHA-256. The final independent verifier must rebuild the entire aggregate from raw events,
   compare canonical bytes and artifact digest, and retain both source-verification records privately.
7. Dispatch `authorization-evidence-approval.yml` separately for `security_owner`, `release_owner`,
   and `cutover_owner`; protected environments must use distinct Ed25519 keys and reviewers.
8. Dispatch `authorization-cutover-evidence.yml` with the exact four source run IDs.
9. Preserve `authorization-final-verified-<run>` and its `sha256sums.txt` privately.
10. The workflow must terminate at `STOP_BEFORE_AUTHORIZATION_MODE_CHANGE`. This failure is
    deliberate and proves evidence generation cannot activate the mode.

## Cutover Refusal

Production startup refuses before seed, Redis, sockets, jobs, or listen when capability-only is
requested with an unknown mode; missing/unreadable evidence; malformed JSON; wrong or reused keys;
invalid Ed25519 signature; stale/future timestamps; a window under 24 hours; missing canaries or
coverage; a mismatch; a local/non-private source; wrong commit/deployment/service/config/migration
binding; missing security/release/cutover approval; or any non-approve decision.

Do not set `AUTHORIZATION_MODE=capability_only` from an evidence workflow. A separate reviewed
change window must re-verify the final package against the running deployment and obtain explicit
human authorization.

## Cutover Smoke And Rollback

Before changing mode, snapshot current configuration and confirm the rollback owner/on-call. After
an explicitly authorized change, smoke client, lawyer applicant, lawyer MFA, admin MFA, wrong-mode,
ownership/IDOR, socket handshake/event, and catalog behavior. Legacy decisions continue as shadow
telemetry and must not grant or deny capability-only access. Events record the actual authority mode.
Catalog comparison scans the union candidate set so both legacy-only and capability-only divergence
remain visible. Sensitive socket events always reload current user/profile/MFA state; no capability
or authorization-decision cache is permitted.

Any new mismatch, missing canary, telemetry persistence error, unexpected 401/403/503, ownership
failure, or catalog divergence triggers immediate rollback to `AUTHORIZATION_MODE=compatibility`.
Rollback changes configuration only. It must not delete, rewrite, or migrate legacy role data.

## External Blockers

The cutover remains external-blocked until the user/release owner provides an approved compatibility
deployment, production-equivalent isolated staging, at least 24 hours of complete zero mismatch
telemetry, protected key custody/environments, three independent approvals, a controlled cutover
window, and post-change smoke authorization.

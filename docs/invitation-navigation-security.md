# Invitation navigation and telemetry privacy

## Capture and lifecycle

The first inline script in index.html owns a nonenumerable memory-only handoff.
It strips invite from the hash on initial load, capture-phase popstate/hashchange,
and History API pushState/replaceState. A successful URL cleanup precedes proof
publication. Failed cleanup invalidates the older proof and does not accept the
new invitation. The application does not put credentials in history.state or its notification
arguments. Native event URL snapshots are untrusted telemetry inputs and are
sanitized independently.

invitationSecret.js takes each handoff synchronously, replaces the previous proof,
and queues a notification carrying no credential. Each deliberate link opening
gets a new revision; paired navigation events see an already sanitized URL. This
also permits an explicit retry after a network failure. No storage or outbox is
used for credentials. Reload after URL cleanup intentionally loses an unaccepted
proof: reopen the original link.

cloudSlice restarts the existing authenticated bootstrap for newly captured proofs.
Its deduplication key includes the invitation revision as well as session generation.
cloud.js serializes acceptance requests, deduplicates concurrent requests for the
same revision/context and ignores late responses for superseded proofs/sessions.
Successful acceptance clears the matching proof only. Logout, remote signout and
company switching clear pending proofs. A bootstrap reset of old/absent credentials
is identified separately from a new logout, so a newly opened proof can survive
until explicit login. Credential revocation/fail-closed auth behavior is unchanged.
The backend contract and its one-time identity checks are unchanged.

## Independent telemetry boundary

sensitiveTelemetry.js does not depend on capturing/retaining the proof. It removes
invitation URL parameters and standalone 32-character base64url proof strings,
redacts sensitive keys and recursively clones nested payloads. Unreadable events
are dropped; cycles and excessive depth are omitted. Standard SDK-generated Sentry
event/trace IDs and dynamic-sampling public identities are preserved in their
specific SDK fields; arbitrary extra data gets no such exemption.

Sentry remains enabled when configured, including invitation pages. Its
beforeBreadcrumb, beforeSend and beforeSendTransaction hooks use the sanitizer.
Diagnostic events are sanitized before retention and again at export; the global
error boundary sanitizes its own console output. The boundary remains effective
when URL processing fails and when a proof has already been cleared.

The browser proof API remains HTTPS-only except its pre-existing local-loopback
exception. Neither transport checks nor the backend were weakened. Third-party
analytics retains the existing invitation-page suppression and disabled link/session
recording; monitoring is not globally disabled.

## Files changed

- index.html
- src/features/auth/LoginPage.jsx
- src/shared/api/index.js
- src/shared/components/ErrorBoundary.jsx
- src/shared/lib/cloud.js
- src/shared/lib/cloudSync.test.js
- src/shared/lib/diagRing.js
- src/shared/lib/invitationSecret.js
- src/shared/lib/invitationSecret.test.js
- src/shared/lib/monitoring.js
- src/shared/lib/monitoring.test.js
- src/shared/lib/sensitiveTelemetry.js
- src/shared/lib/sensitiveTelemetry.test.js
- src/shared/store/slices/cloudSlice.js
- src/shared/store/slices/invitationFlow.test.js
- docs/invitation-navigation-security.md

## Release notes

No backend, SQL, migration or business posting changes. Existing clients running
an older frontend must reload to receive this fix. Do not reactivate the old
accept-by-email backend. The separately identified backend rate-limit HTTP 500/429
mapping issue is unchanged and outside this frontend security stage.


## Verification

Final frontend suite: 779/779; ESLint zero errors and 101 existing warnings;
production build and git diff --check passed. A fresh temporary source copy with
public test configuration was used for the build, without copying secret .env files.

Real Microsoft Edge 156.0.4314.42, production build and active service worker,
isolated PostgreSQL 17.10 with migrations through 0033: 17/17 original browser
scenarios and four additional navigation/lifecycle groups passed. Six actual Sentry
request payloads were intercepted locally: zero proof matches, valid SDK IDs, no
external delivery. Storage, diagnostic and log scans had zero matches; IndexedDB
had no databases. No stock, money or settlement movements were created.

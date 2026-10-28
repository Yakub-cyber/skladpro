# Commercial orders v2 — frontend

New authenticated cloud orders use POST /v1/orders. Confirmed protected orders use
PUT /v1/orders/:id/commercial. Demo orders and historical cloud orders are not adopted.
Shipment, delivery, cancellation and courier workflow for protected orders are deliberately
disabled in this stage; no local stock, money or debt mutation accompanies commercial saves.

## Acceptance and recovery

`commercialOrders.js` prepares the complete decimal-string commercial snapshot. Only proven
catalog base units are accepted for new lines. Stable line IDs, orderId, commandId, explicit
rounding and the full HTTP envelope are reserved by businessIntent, then durably accepted by
the existing immutable outbox. The key is `commercial:<commandId>` and never reconstructed
on retry. Storage failures return a failed/unfinished result; they do not report final success.
An accepted command reconstructs its pending preview after offline reload without relying
on a mutable cached order row.

Creating and then editing before the first confirmation is intentionally disallowed. A second
edit while an earlier edit is pending is also disallowed: its future row_version is unknown.
Confirmed orders can be edited offline with their captured server version and base snapshot.
Competing tabs still use server optimistic concurrency; no automatic overwrite resolves 409.
Same-order commands participate in existing dependency barriers and Web Locks. Commercial
commands are non-stock and do not introduce a company-wide stock barrier.

## Server truth and old replay

The client validates the permanent receipt's identity, commercial snapshot and SHA-256 using
the backend canonicalization. A replay can return an old receipt, so confirmation also fetches
the current native server order before acknowledgement. Current truth is durably appended as
a separate scoped authority record, keyed by user, company, order and server row_version.
The greatest observed row_version wins; an old response or stale generic cache cannot restore
an older composition. Generic cache rows are never sufficient authority for a protected order.
Each sync table is paged using its own cursor, including the product-unit catalog.

Authority persistence failure or an unavailable current row leaves the exact command pending.
409/422 retain the command in quarantine and expose its error on the order and sync diagnostics.
Company/user/generation guards prevent late responses from entering a different session.
Storage events and outbox notifications update another tab's pending and confirmed views.
Protected rows are excluded symmetrically from legacy sync upserts/deletes; already queued
legacy writes to those IDs are quarantined for review, not silently discarded.

## Supported UI subset

- New order form: company catalog base units, quantities up to four decimals, prices up to
  two decimals, percentage discount, explicit whole-ruble rounding, customer/address/geo,
  price type, active shift and unpaid or credit intent. Credit intent does not create debt.
- Editing: full snapshot replacement from a trusted version, stable source line IDs,
  quantities/prices/percentage discount/credit intent, preserving other commercial metadata.
- New packaged/marked lines, actual payments, VAT breakdown and additional credit terms
  are rejected explicitly. Editing externally created orders with absolute discounts or
  duplicate product lines is rejected because this editor cannot represent them faithfully.
- Cloud storefront checkout is blocked until its inline customer creation can supply a
  confirmed customer identity; it never falls back to a legacy order write.

No SQL, backend contract, reconciliation protocol, financial rules or shipment UI is changed.
Confirmed authority revisions and command journals have no automatic cleanup in this stage.

## Validation

Targeted tests cover durable creation/editing, offline reload, quota failure with stable retry,
immutable duplicate/conflict, lost response, old replay, version conflict, scoped context,
quarantine/dependency barriers, exact decimals, receipt validation and legacy-sync exclusion.
Real Edge scenarios use production assets, an active service worker and an isolated PostgreSQL:
offline creation/editing with reload, independent-client readback, concurrent-editor 409,
lost committed response, old replay, and two tabs sharing one command through Web Locks.

Files changed in this frontend stage (other pre-existing working-tree changes are preserved):

- `src/shared/lib/commercialOrders.js`, `src/shared/lib/commercialOrders.test.js`
- `src/shared/lib/businessIntent.js`, `src/shared/lib/outbox.js`, `src/shared/lib/outboxDependencies.js`
- `src/shared/lib/scopedCache.js`, `src/shared/lib/cloud.js`, `src/shared/lib/cloudSync.test.js`
- `src/shared/api/index.js`, `src/shared/api/index.test.js`
- `src/shared/store/slices/ordersSlice.js`
- `src/features/orders/NewOrderPage.jsx`, `src/features/orders/EditOrderPage.jsx`
- `src/features/orders/components/CartBody.jsx`, `src/features/orders/components/MobileCartBar.jsx`
- `src/features/orders/components/OrderDetail.jsx`, `src/features/storefront/StorefrontPage.jsx`
- `src/App.jsx`, `scripts/offlineManifest.js`, `src/shared/lib/offlineManifest.test.js`
- This document.

Final automated checks: frontend 670/670 (39 files); ESLint zero errors, 101 warnings;
production build passed. Backend typecheck passed; regression suite with real isolated
PostgreSQL passed 456/456 (32 files). No backend source changes were made in this stage.
Storage refusal, logout/company guards and 422 behavior are covered by automated tests;
they are not represented as browser-level failure-injection checks.

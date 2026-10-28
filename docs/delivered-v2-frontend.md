# Delivered v2 — durable frontend delivery

Protected cloud orders use a separate immutable outbox type `order_delivery`. Historical orders
are not adopted; the legacy setOrderStatus path remains blocked for protected orders. No cancelled
v2, backend, SQL, migration or financial-policy change is included in this frontend stage.

## Trusted source and acceptance

The gate requires a current scoped commercial authority in shipped with stock consumed and a
matching shipment document. Its original immutable shipment-v2 command must have a durable
transport acknowledgement, no quarantine and the same full commercial snapshot. An authenticated,
validated warehouse snapshot must contain an applied result for the exact original HTTP envelope
and key. The result must include the linked shipment document's effect.

The original shipment fingerprint is SHA-256 over `{companyId,orderId,...originalShipmentBody}`
using the existing canonical format. It is derived only after the above permanent-proof checks;
it is not guessed from product, warehouse, timestamp or current mutable order items. An independent
device lacking the original acknowledged envelope/proof cannot create a delivery in this stage.
Missing/outdated proof fails explicitly and asks for an online data refresh, without changing stock.

After verifying the session generation, businessIntent reserves and outbox durably accepts:

```
key: order_delivery
id / Idempotency-Key: delivered:<original shipmentId>
obj: {orderId,request:{contractVersion:2,status:"delivered",shipmentId,shipmentFingerprint}}
```

URL identity and the complete request are immutable together. No new shipment UUID is generated.
The transport posts the saved request verbatim through the existing API client. Enqueue failure
reports failure and retains the reserved envelope for retry. Pending delivery is reconstructed
from the scoped journal after offline reload; it never sets confirmed status optimistically.

## Dependencies and state

Delivery is a non-stock business command with an orderId dependency. Existing Web Locks, tenant
isolation, predecessor barriers and quarantine remain active. Unresolved commercial/shipment
commands block acceptance and sending. Same identity with another payload/key is a conflict,
not a catalogue merge. Existing journals/commands are not rewritten or deleted.

Only pending/review order metadata is projected. The action does not call applyOrderStock and
does not modify products, balances, money or customer debt. Delivery is excluded from warehouse
command requests and stock arithmetic. Reconciliation of the original shipment is unchanged.

Before acknowledgement the client verifies delivery fingerprint, command/order/shipment/document,
row version and timestamp, then fetches and durably stores the current native order. Its version
must cover the returned historical receipt. Old replay cannot restore delivered over a newer state.
A lost HTTP response, failed current read or cache persistence failure retains the exact command.
409/422 refresh current order where possible but preserve the original request and error in
quarantine for review. A replay header alone never acknowledges an unsuccessful/unverified response.
Logout/company generation checks prevent late responses from writing or acknowledging another scope.

OrderDetail and DeliveryPage call the dedicated delivery action for protected orders. Pending and
review states are visible; there is no optimistic delivered badge. DeliveryPage is included in the
build-generated critical resource graph and guarded by RouteImportBoundary, retaining code splitting.

## Files changed in this stage

- `src/shared/lib/deliveryV2.js`, `deliveryV2.test.js`
- `src/shared/store/slices/ordersSlice.js`
- `src/shared/lib/businessIntent.js`, `outbox.js`, `outboxDependencies.js`
- `src/shared/lib/scopedCache.js`, `cloud.js`, `cloudSync.test.js`
- `src/features/orders/components/DeliveryPanel.jsx`, `DeliveryPanel.test.jsx`, `OrderDetail.jsx`
- `src/features/delivery/DeliveryPage.jsx`
- `src/App.jsx`, `scripts/offlineManifest.js`, `src/shared/lib/offlineManifest.test.js`
- This document.

## Validation scope

Tests cover immutable repeat/conflict, offline recovery, failed enqueue/current-cache write, session
changes, dependency gates, original applied-proof matching, HTTP 409/422 and historical receipt/current
state separation. UI tests distinguish pending, review and actual confirmed server status.
Real Edge 156 production/service-worker runs use isolated PostgreSQL: A40/B60 -> confirmed shipment
of two units -> A38/B60, 200 RUB debt -> offline delivery -> offline reload -> server delivered.
Lost committed response and two real tabs are separate scenarios. Delivery adds one lifecycle
receipt/audit event, zero stock/money/debt movements, and leaves shipment source_payload unchanged.
Storage/session/409/422 failure injection is automated testing, not claimed as browser coverage.

Final results: frontend 712/712 (42 files), ESLint zero errors with 101 existing warnings,
production build passed. Backend typecheck and full real-PostgreSQL regression suite passed
477/477 (33 files), without backend source changes. git diff --check and untracked-file whitespace
checks passed. Actual Edge 156.0.4314.42 passed offline/reload, lost-response and two-tab runs on
the final production bundle. An additional run first opened DeliveryPage offline and used its
delivery button; delivery metadata for that fixture was set through the existing commercial API
before shipment. All runs retained A38/B60, debt 200 RUB, one receipt and one delivery audit event,
with zero delivery stock/money/debt movements and unchanged shipment proof.

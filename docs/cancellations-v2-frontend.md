# Cancelled v2 frontend

Only a protected commercial order with a locally retained, acknowledged shipment-v2 command,
current confirmed shipped header and exact applied warehouse snapshot proof can be cancelled.
Historical orders and shipments without this local proof are not adopted automatically.
The same verified source reader used by delivery supplies shipmentId and the full original
shipment body; its canonical SHA-256 yields the original shipmentFingerprint.

## Durable command

`key: order_cancel`, `id: cancelled:<shipmentId>`, identical `idempotencyKey`.
The immutable object is `{orderId, request, projection:{warehouseId,items}}`.
`request` is exactly `{contractVersion:2,status:"cancelled",shipmentId,shipmentFingerprint}`.
Projection metadata comes from the verified original shipment and is never added to HTTP body.
Outbox persistence and read-back precede the pending UI. Retry never rebuilds this body.
A storage failure leaves the attempt unaccepted with an explicit error and stable reservation.

Cancel and delivery admission share the scoped lifecycle order Web Lock. Existing opposite
commands, including acknowledged delivery, block the other action; identical cancel retries
use the existing immutable-command conflict checks. Flush retains its scoped Web Lock and
order/resource dependency barrier. Cancellation resources include orderId and all original
warehouse/product pairs. Quarantine is retained, not automatically retried or removed.

## UI and stock

Cancellation remains pending; it does not set cancelled, change customer debt, create money
rows or restore stock optimistically. Until reconciliation, affected warehouse forecasts are
unavailable. Confirmed baseline values are preserved; unrelated products remain independent.
409/422 are visible durable quarantine. Local payment absence never authorizes server cancellation.
Delivery and edits cannot bypass a pending cancellation via ordinary status actions.

The successful HTTP result is validated and current order state refetched/persisted before ack.
The historical receipt is not applied as current order state. Confirmation triggers a fresh
scoped load, including current customers and warehouse reconciliation, with session generation
checks. A failed read keeps the command for replay.

Reconcile sends `{kind:"order_cancel",commandId:"cancelled:<shipmentId>",orderId,
idempotencyKey:"cancelled:<shipmentId>",payload:request}`. Global commandId uniqueness remains.
When included together, cancellation applied requires original shipment reversed and the same
source document. Both effects are then already in the atomic baseline: no local correction is
added. Conflict/unverifiable/not_observed retain the command and do not manufacture restoration.
not_observed does not authorize a new identity or prove absence of a future commit.

Existing production offline manifest follows Rollup's actual critical route graph, including
OrderDetail and the cancellation panel, without handwritten hashed asset names. Service worker
and backend contracts/schema are unchanged by this stage.

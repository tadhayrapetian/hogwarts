import type { Order, OrderItem, OrderShippingStatus, OrderStatus, ProjectStage, Shipment, ShipmentStatus } from './types';
import { round } from './util';

export function subtotal(items: OrderItem[]): number {
  return round(items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0));
}

export function discountAmount(order: Pick<Order, 'items' | 'discountType' | 'discountValue'>): number {
  const sub = subtotal(order.items);
  const v = Number(order.discountValue) || 0;
  if (order.discountType === 'percent') return round(Math.min(sub, (sub * Math.min(100, Math.max(0, v))) / 100));
  return round(Math.min(sub, Math.max(0, v)));
}

export function orderTotal(order: Pick<Order, 'items' | 'discountType' | 'discountValue' | 'shippingFee'>): number {
  return round(subtotal(order.items) - discountAmount(order) + (Number(order.shippingFee) || 0));
}

export function balanceDue(order: Pick<Order, 'total' | 'amountPaid'>): number {
  return round(Math.max(0, order.total - (order.amountPaid || 0)));
}

/** Orders that still require work (used by dashboards & notifications). */
export const OPEN_ORDER_STATUSES: OrderStatus[] = ['new', 'confirmed', 'in_production', 'ready_to_print', 'printed', 'packed'];
export const COMPLETED_ORDER_STATUSES: OrderStatus[] = ['delivered'];

export function isOrderOpen(o: Order): boolean {
  return OPEN_ORDER_STATUSES.includes(o.status);
}

/** Derives the order shipping status from its shipments. */
export function deriveOrderShipping(shipments: Shipment[]): OrderShippingStatus {
  if (!shipments.length) return 'not_shipped';
  const s = shipments.map((x) => x.status);
  if (s.every((x) => x === 'delivered')) return 'delivered';
  if (s.some((x) => x === 'returned')) return 'returned';
  const moving: ShipmentStatus[] = ['shipped', 'in_transit', 'out_for_delivery', 'delivered'];
  if (s.every((x) => moving.includes(x))) return 'shipped';
  if (s.some((x) => moving.includes(x))) return 'partially';
  return 'not_shipped';
}

/** Suggests an order status from the least advanced project stage of the order. */
export function orderStatusFromStages(stages: ProjectStage[], current: OrderStatus): OrderStatus {
  if (!stages.length || ['cancelled', 'archived', 'shipped', 'delivered'].includes(current)) return current;
  const rank: ProjectStage[] = ['created', 'approved', 'generated', 'printed', 'cut', 'folded', 'packed', 'ready'];
  const min = Math.min(...stages.map((s) => rank.indexOf(s)));
  const stage = rank[min];
  if (stage === 'created') return current === 'new' ? 'new' : current === 'confirmed' ? 'confirmed' : 'in_production';
  if (stage === 'approved') return 'in_production';
  if (stage === 'generated') return 'ready_to_print';
  if (stage === 'printed' || stage === 'cut' || stage === 'folded') return 'printed';
  return 'packed';
}

export const SHIPMENT_FLOW: ShipmentStatus[] = ['preparing', 'label_created', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];

export function nextShipmentStatus(s: ShipmentStatus): ShipmentStatus | undefined {
  const i = SHIPMENT_FLOW.indexOf(s);
  return i >= 0 && i < SHIPMENT_FLOW.length - 1 ? SHIPMENT_FLOW[i + 1] : undefined;
}

export const ORDER_FLOW: OrderStatus[] = ['new', 'confirmed', 'in_production', 'ready_to_print', 'printed', 'packed', 'shipped', 'delivered'];

export function nextOrderStatus(s: OrderStatus): OrderStatus | undefined {
  const i = ORDER_FLOW.indexOf(s);
  return i >= 0 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : undefined;
}

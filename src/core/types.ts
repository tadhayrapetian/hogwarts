/**
 * Domain model of the Hogwarts Mail Management System.
 *
 * Everything is linked by ids:
 *   Customer ─┐
 *   Recipient ┴→ Order → Project → GeneratedDoc (letter / documents)
 *                              ↘ PrintBatch → Shipment → History
 *
 * Human-readable codes (HM-2026-001842, #000184, B-2026-0042 …) live in `code`/`number`
 * fields; internal ids are random UUIDs so records can be merged, imported and synced.
 */

export type ID = string;
/** Calendar date, YYYY-MM-DD. */
export type ISODate = string;
/** Full ISO timestamp. */
export type ISODateTime = string;

export type Lang = 'en' | 'ru' | 'hy';

// ───────────────────────────── Security ─────────────────────────────

export type RoleKey = 'admin' | 'editor' | 'production' | 'viewer';

export const PERMISSIONS = [
  'recipients.view',
  'recipients.edit',
  'recipients.delete',
  'recipients.contact',
  'orders.view',
  'orders.edit',
  'projects.edit',
  'design.edit',
  'templates.edit',
  'production.edit',
  'print',
  'shipping.edit',
  'inventory.edit',
  'analytics.view',
  'files.edit',
  'data.import',
  'data.export',
  'settings.edit',
  'users.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface User {
  id: ID;
  username: string;
  displayName: string;
  role: RoleKey;
  passwordHash: string;
  salt: string;
  iterations: number;
  active: boolean;
  mustChangePassword?: boolean;
  createdAt: ISODateTime;
  lastLoginAt?: ISODateTime;
}

// ───────────────────────────── CRM ─────────────────────────────

export const ADDRESS_LABELS = ['home', 'school', 'parent', 'alternative', 'temporary', 'billing', 'other'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export interface Address {
  id: ID;
  label: AddressLabel;
  /** Addressee line override (e.g. "c/o Mrs. Smith"). Empty → recipient name. */
  name: string;
  line1: string;
  /** Apartment / house number. */
  line2: string;
  /** Additional address information (building, entrance …). */
  extra: string;
  city: string;
  region: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  notes: string;
}

export const RECIPIENT_STATUSES = ['active', 'prospect', 'paused', 'archived', 'anonymized'] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const CONTACT_METHODS = ['email', 'phone', 'sms', 'post', 'none'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export interface Recipient {
  id: ID;
  /** Six digit public number, shown as #000184. */
  code: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  /** Full date of birth (only when the workspace allows storing it). */
  dob?: ISODate;
  /** Manually entered age, used when no full date of birth is stored. */
  age?: number;
  /** Birthday as MM-DD, kept even when the year is not stored. */
  birthday?: string;
  gender?: string;

  addresses: Address[];
  defaultAddressId?: ID;

  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  altContact: string;
  preferredContact: ContactMethod;

  deliveryInstructions: string;
  mailingNotes: string;

  houseId?: ID;
  schoolYear?: number;
  favoriteSubject: string;
  favoriteColor: string;
  petName: string;
  owlName: string;
  characterId?: ID;
  favoriteCreature: string;
  interests: string;
  specialOccasion: string;
  specialOccasionDate?: ISODate;

  customerId?: ID;
  status: RecipientStatus;
  tagIds: ID[];
  notes: string;

  /** Denormalised from the default mailing address for fast filtering. */
  city: string;
  country: string;

  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: string;
  updatedBy?: string;
  lastContactAt?: ISODateTime;
  anonymizedAt?: ISODateTime;
}

export interface Customer {
  id: ID;
  code: string;
  name: string;
  email: string;
  phone: string;
  billingAddress?: Address;
  notes: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Tag {
  id: ID;
  name: string;
  color: string;
}

export interface Note {
  id: ID;
  recipientId: ID;
  text: string;
  pinned: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: string;
}

export const TASK_TYPES = ['contact', 'birthday', 'followup', 'production', 'other'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface Task {
  id: ID;
  title: string;
  type: TaskType;
  recipientId?: ID;
  orderId?: ID;
  dueDate: ISODate;
  done: boolean;
  doneAt?: ISODateTime;
  notes: string;
  createdAt: ISODateTime;
  createdBy: string;
}

export const FILE_OWNER_TYPES = ['recipient', 'project', 'order', 'customer'] as const;
export type FileOwnerType = (typeof FILE_OWNER_TYPES)[number];
export const FILE_CATEGORIES = ['photo', 'document', 'design', 'pdf', 'note', 'other'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export interface FileRec {
  id: ID;
  ownerType: FileOwnerType;
  ownerId: ID;
  name: string;
  mime: string;
  size: number;
  category: FileCategory;
  description: string;
  blob: Blob;
  createdAt: ISODateTime;
  createdBy: string;
}

// ───────────────────────────── World building ─────────────────────────────

export interface House {
  id: ID;
  name: string;
  symbol: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  motto: string;
  description: string;
  sealId?: ID;
  crestStyle: 'shield' | 'round' | 'banner';
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const CHARACTER_ROLES = ['headmaster', 'deputy', 'professor', 'librarian', 'postmaster', 'archivist', 'house_rep', 'other'] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];
export const WRITING_STYLES = ['formal', 'warm', 'mysterious', 'playful', 'scholarly'] as const;
export type WritingStyle = (typeof WRITING_STYLES)[number];

export interface Character {
  id: ID;
  name: string;
  role: CharacterRole;
  title: string;
  department: string;
  houseId?: ID;
  signatureText: string;
  signatureFont: FontKey;
  signatureColor: string;
  sealId?: ID;
  portraitAssetId?: ID;
  portraitSymbol: string;
  portraitColor: string;
  writingStyle: WritingStyle;
  signOff: string;
  bio: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Asset {
  id: ID;
  name: string;
  mime: string;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
  createdAt: ISODateTime;
}

// ───────────────────────────── Design system ─────────────────────────────

export const FONT_KEYS = [
  'cormorant',
  'garamond',
  'cinzel',
  'fell',
  'greatvibes',
  'pinyon',
  'marck',
  'armenian',
  'inter',
  'oswald',
  'typewriter',
] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const PAPER_KINDS = ['parchment', 'cream', 'ivory', 'aged', 'white', 'kraft', 'midnight', 'custom'] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];

export interface PaperStyle {
  kind: PaperKind;
  color: string;
  /** 0..1 fibre / grain noise intensity. */
  texture: number;
  /** 0..1 darkened edges. */
  vignette: number;
  /** Subtle age stains. */
  stains: boolean;
}

export const BORDER_STYLES = ['none', 'single', 'double', 'ornate', 'deco', 'filigree', 'dashed', 'stamp'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export interface BorderSpec {
  style: BorderStyle;
  color: string;
  width: number;
  inset: number;
}

export interface WatermarkSpec {
  kind: 'none' | 'symbol' | 'text' | 'badge';
  value: string;
  opacity: number;
  size: number;
  color: string;
  rotation: number;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface BaseEl {
  id: ID;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  hidden?: boolean;
}

export interface TextEl extends BaseEl {
  type: 'text';
  text: string;
  font: FontKey;
  /** Points. */
  size: number;
  weight: 400 | 500 | 600 | 700;
  italic?: boolean;
  color: string;
  align: 'left' | 'center' | 'right' | 'justify';
  valign?: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  /** Extra tracking in em. */
  letterSpacing?: number;
  transform?: 'none' | 'uppercase' | 'lowercase' | 'mirror';
  dropCap?: boolean;
  dropCapColor?: string;
  autoFit?: boolean;
  paragraphSpacing?: number;
}

export interface ImageEl extends BaseEl {
  type: 'image';
  assetId?: ID;
  fit: 'contain' | 'cover' | 'stretch';
  filter?: 'none' | 'sepia' | 'grayscale';
}

export interface SignatureEl extends BaseEl {
  type: 'signature';
  /** Character id or "$sender" (the project's sender). */
  characterRef: string;
  showName: boolean;
  showTitle: boolean;
}

export interface SealEl extends BaseEl {
  type: 'seal';
  /** Seal id, "$project", "$house" (recipient's house) or "$sender". */
  sealRef: string;
}

export interface StampEl extends BaseEl {
  type: 'stamp';
  /** Stamp id or "$project". */
  stampRef: string;
}

export interface PostmarkEl extends BaseEl {
  type: 'postmark';
  /** Postmark id or "$project". */
  postmarkRef: string;
}

export interface BadgeEl extends BaseEl {
  type: 'badge';
  /** House id, "$recipient" or "$school". */
  houseRef: string;
  showName: boolean;
}

export interface SymbolEl extends BaseEl {
  type: 'symbol';
  symbol: string;
  color: string;
  strokeWidth: number;
}

export interface DividerEl extends BaseEl {
  type: 'divider';
  style: 'line' | 'double' | 'dotted' | 'ornament' | 'flourish' | 'diamond';
  color: string;
  thickness: number;
}

export interface ShapeEl extends BaseEl {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'roundrect' | 'ornateframe' | 'banner';
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
}

export interface BarcodeEl extends BaseEl {
  type: 'barcode';
  value: string;
  showText: boolean;
  color: string;
}

export type DesignEl =
  | TextEl
  | ImageEl
  | SignatureEl
  | SealEl
  | StampEl
  | PostmarkEl
  | BadgeEl
  | SymbolEl
  | DividerEl
  | ShapeEl
  | BarcodeEl;
export type DesignElType = DesignEl['type'];

export interface Layout {
  /** Millimetres. */
  w: number;
  h: number;
  paper: PaperStyle;
  border: BorderSpec;
  watermark: WatermarkSpec;
  margins: Margins;
  elements: DesignEl[];
}

export const ENVELOPE_SIZES = ['DL', 'C6', 'C5', 'A5', 'A4', 'custom'] as const;
export type EnvelopeSize = (typeof ENVELOPE_SIZES)[number];
export type FlapShape = 'pointed' | 'straight' | 'curved' | 'wallet';
export type LinerPattern = 'none' | 'stripes' | 'stars' | 'damask' | 'dots' | 'diamonds';

export interface EnvelopeDesign {
  id: ID;
  name: string;
  size: EnvelopeSize;
  flap: FlapShape;
  front: Layout;
  back: Layout;
  liner: { pattern: LinerPattern; color: string; color2: string };
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const STAMP_CATEGORIES = [
  'owl_post',
  'express',
  'special_delivery',
  'school_mail',
  'air_mail',
  'archive',
  'birthday',
  'christmas',
  'invitation',
  'secret',
] as const;
export type StampCategory = (typeof STAMP_CATEGORIES)[number];

export interface Stamp {
  id: ID;
  name: string;
  category: StampCategory;
  shape: 'perforated' | 'rounded' | 'circle' | 'triangle' | 'oval';
  w: number;
  h: number;
  bg: string;
  frame: string;
  ink: string;
  accent: string;
  symbol: string;
  assetId?: ID;
  title: string;
  value: string;
  subtitle: string;
  font: FontKey;
  pattern: 'none' | 'guilloche' | 'lines' | 'dots' | 'rays';
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const POSTMARK_SHAPES = ['circle', 'double', 'oval', 'rect', 'octagon', 'duplex', 'wavy'] as const;
export type PostmarkShape = (typeof POSTMARK_SHAPES)[number];

export interface Postmark {
  id: ID;
  name: string;
  text: string;
  location: string;
  dateFormat: 'DD MMM YYYY' | 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'MMM DD YYYY' | 'DD MMM';
  dateSource: 'today' | 'fixed' | 'ship';
  fixedDate?: ISODate;
  number: string;
  shape: PostmarkShape;
  /** Diameter / width in mm. */
  size: number;
  opacity: number;
  rotation: number;
  /** 0..1, how worn and patchy the ink looks. */
  inkWear: number;
  color: string;
  font: FontKey;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const SEAL_TYPES = ['wax', 'embossed', 'ink', 'official'] as const;
export type SealType = (typeof SEAL_TYPES)[number];
export const SEAL_SHAPES = ['round', 'scalloped', 'irregular', 'octagon', 'shield'] as const;
export type SealShape = (typeof SEAL_SHAPES)[number];

export interface Seal {
  id: ID;
  name: string;
  type: SealType;
  shape: SealShape;
  color: string;
  symbol: string;
  text: string;
  initials: string;
  year: string;
  /** Diameter in mm. */
  size: number;
  ribbons: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const TEMPLATE_CATEGORIES = [
  'admission',
  'welcome',
  'birthday',
  'christmas',
  'invitation',
  'quest',
  'school_event',
  'certificate',
  'award',
  'card',
  'secret',
  'general',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const DOCUMENT_TYPES = [
  'admission_letter',
  'invitation',
  'certificate',
  'diploma',
  'award',
  'student_card',
  'library_card',
  'house_certificate',
  'quest_card',
  'secret_message',
  'achievement_certificate',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type FoldStyle = 'none' | 'half' | 'trifold';

export interface Template {
  id: ID;
  name: string;
  kind: 'letter' | 'document';
  category: TemplateCategory;
  docType: DocumentType;
  description: string;
  language: Lang;
  layout: Layout;
  envelopeId?: ID;
  stampId?: ID;
  postmarkId?: ID;
  sealId?: ID;
  senderId?: ID;
  documentTemplateIds: ID[];
  fold: FoldStyle;
  archived?: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ───────────────────────────── Commerce ─────────────────────────────

export const PRODUCT_CATEGORIES = ['package', 'letter', 'document', 'addon', 'shipping'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface Product {
  id: ID;
  sku: string;
  name: string;
  description: string;
  category: ProductCategory;
  price: number;
  templateId?: ID;
  documentTemplateIds: ID[];
  active: boolean;
  createdAt: ISODateTime;
}

export const ORDER_STATUSES = [
  'new',
  'confirmed',
  'in_production',
  'ready_to_print',
  'printed',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'archived',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PRODUCTION_STATUSES = ['not_started', 'in_progress', 'done'] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];
export const ORDER_SHIPPING_STATUSES = ['not_shipped', 'partially', 'shipped', 'delivered', 'returned'] as const;
export type OrderShippingStatus = (typeof ORDER_SHIPPING_STATUSES)[number];

export interface OrderItem {
  id: ID;
  productId?: ID;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface StatusEvent<S extends string = string> {
  status: S;
  at: ISODateTime;
  by: string;
  note?: string;
}

export interface Order {
  id: ID;
  number: string;
  customerId?: ID;
  recipientId?: ID;
  items: OrderItem[];
  discountType: 'amount' | 'percent';
  discountValue: number;
  shippingFee: number;
  total: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  productionStatus: ProductionStatus;
  shippingStatus: OrderShippingStatus;
  trackingNumber: string;
  dueDate?: ISODate;
  notes: string;
  statusHistory: StatusEvent<OrderStatus>[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: string;
}

// ───────────────────────────── Production ─────────────────────────────

export const PROJECT_STAGES = ['created', 'approved', 'generated', 'printed', 'cut', 'folded', 'packed', 'ready'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export interface ProjectDoc {
  id: ID;
  templateId?: ID;
  name: string;
  docType: DocumentType;
  layout: Layout;
}

export interface Project {
  id: ID;
  code: string;
  name: string;
  recipientId?: ID;
  orderId?: ID;
  templateId?: ID;
  category: TemplateCategory;
  letter: Layout;
  envelope: EnvelopeDesign;
  stampId?: ID;
  postmarkId?: ID;
  /** Overrides the postmark date for this project. */
  postmarkDate?: ISODate;
  sealId?: ID;
  senderId?: ID;
  documents: ProjectDoc[];
  fold: FoldStyle;
  print: Partial<PrintSettings>;
  shipping: { addressId?: ID; carrierId?: string; service?: string; notes: string };
  stage: ProjectStage;
  status: 'active' | 'archived';
  batchId?: ID;
  assembly: Record<string, boolean>;
  inventoryDeducted?: boolean;
  dueDate?: ISODate;
  stageHistory: StatusEvent<ProjectStage>[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy: string;
}

export type GeneratedKind = 'letter' | 'document' | 'envelope' | 'label';

export interface GeneratedDoc {
  id: ID;
  code: string;
  /** Document reference printed on the item, e.g. ADM/2026/00184. */
  number: string;
  projectId: ID;
  recipientId?: ID;
  orderId?: ID;
  kind: GeneratedKind;
  templateId?: ID;
  title: string;
  docType?: DocumentType;
  /** Resolved text (all variables substituted) – a frozen record of what was sent. */
  text: string;
  status: 'generated' | 'printed' | 'void';
  batchId?: ID;
  createdAt: ISODateTime;
  printedAt?: ISODateTime;
  createdBy: string;
}

export const PAPER_SIZES = ['A4', 'A5', 'A3', 'Letter', 'Legal', 'custom'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export const LABEL_PRESETS = ['L7160', 'L7163', 'L7165', 'L7173', 'custom'] as const;
export type LabelPreset = (typeof LABEL_PRESETS)[number];

export interface PrintSettings {
  paper: PaperSize;
  paperW: number;
  paperH: number;
  orientation: 'portrait' | 'landscape' | 'auto';
  margins: number;
  bleed: number;
  cropMarks: boolean;
  cutLines: boolean;
  foldLines: boolean;
  safeArea: boolean;
  scale: number;
  resolution: number;
  envelopeMode: 'direct' | 'dieline';
  labelPreset: LabelPreset;
  labelW: number;
  labelH: number;
  labelCols: number;
  labelRows: number;
  labelGap: number;
}

export const BATCH_STATUSES = ['draft', 'ready', 'printed', 'completed'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface BatchInclude {
  letters: boolean;
  envelopes: boolean;
  labels: boolean;
  stamps: boolean;
  documents: boolean;
  packingSlips: boolean;
}

export interface PrintBatch {
  id: ID;
  code: string;
  name: string;
  projectIds: ID[];
  status: BatchStatus;
  settings: PrintSettings;
  include: BatchInclude;
  notes: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  printedAt?: ISODateTime;
  createdBy: string;
}

// ───────────────────────────── Logistics ─────────────────────────────

export const SHIPMENT_STATUSES = [
  'preparing',
  'label_created',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'returned',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface Shipment {
  id: ID;
  code: string;
  orderId?: ID;
  projectId?: ID;
  recipientId?: ID;
  recipientName: string;
  address: Address;
  carrierId: string;
  service: string;
  trackingNumber: string;
  shippingDate?: ISODate;
  estimatedDelivery?: ISODate;
  deliveredAt?: ISODateTime;
  status: ShipmentStatus;
  cost: number;
  weight: number;
  events: StatusEvent<ShipmentStatus>[];
  notes: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Carrier {
  id: string;
  name: string;
  trackingUrl: string;
  services: string[];
  active: boolean;
}

export const INVENTORY_CATEGORIES = [
  'envelopes',
  'paper',
  'stamps',
  'wax',
  'seals',
  'cards',
  'packaging',
  'labels',
  'printing',
  'other',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export interface StockMovement {
  id: ID;
  at: ISODateTime;
  delta: number;
  reason: 'purchase' | 'consumption' | 'adjustment' | 'return';
  note: string;
  by: string;
}

export interface InventoryItem {
  id: ID;
  name: string;
  category: InventoryCategory;
  sku: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  location: string;
  supplierId?: ID;
  cost: number;
  notes: string;
  /** Consumed automatically each time a mail package is packed. */
  usagePerPackage: number;
  movements: StockMovement[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Supplier {
  id: ID;
  name: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  products: string;
  prices: string;
  notes: string;
  lastOrder?: ISODate;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ───────────────────────────── System ─────────────────────────────

export const ACTIVITY_ACTIONS = [
  'create',
  'update',
  'delete',
  'anonymize',
  'merge',
  'generate',
  'print',
  'ship',
  'status',
  'import',
  'export',
  'login',
  'logout',
  'backup',
  'restore',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface Activity {
  id: ID;
  ts: ISODateTime;
  userId: string;
  userName: string;
  role: string;
  action: ActivityAction;
  entityType: string;
  entityId?: ID;
  entityLabel?: string;
  recipientId?: ID;
  summary: string;
  /** Names of changed fields – never the values (data minimisation). */
  fields?: string[];
}

export interface Counter {
  key: string;
  value: number;
}

export interface Dismissal {
  key: string;
  at: ISODateTime;
}

export interface DuplicateDecision {
  key: string;
  decision: 'keep_both' | 'ignore';
  at: ISODateTime;
  by: string;
}

export const CURRENCIES = ['GBP', 'USD', 'EUR', 'RUB', 'AMD', 'CAD', 'AUD', 'CHF'] as const;
export const DATE_FORMATS = ['DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface NotificationSettings {
  newOrder: boolean;
  lowStock: boolean;
  birthdays: boolean;
  birthdayDays: number;
  unprinted: boolean;
  unprintedDays: number;
  unshipped: boolean;
  unshippedDays: number;
  returned: boolean;
  missingAddress: boolean;
  invalidPostal: boolean;
  overdue: boolean;
}

export interface AppSettings {
  key: 'app';
  company: {
    systemName: string;
    name: string;
    schoolName: string;
    motto: string;
    email: string;
    phone: string;
    website: string;
    address: string;
    logoAssetId?: ID;
  };
  mail: {
    returnAddress: string;
    defaultCarrierId: string;
    defaultSenderId?: ID;
    documentNumberFormat: string;
    orderPrefix: string;
    defaultLetterTemplateId?: ID;
  };
  print: PrintSettings;
  regional: {
    currency: string;
    dateFormat: DateFormat;
    language: Lang;
  };
  defaults: {
    envelopeId?: ID;
    paper: PaperKind;
    stampId?: ID;
    postmarkId?: ID;
    sealId?: ID;
  };
  notifications: NotificationSettings;
  privacy: {
    collectGender: boolean;
    storeFullDob: boolean;
    autoLockMinutes: number;
    retentionMonths: number;
  };
  roles: Record<RoleKey, Permission[]>;
  carriers: Carrier[];
  backup: { lastBackupAt?: ISODateTime; remindDays: number };
  workspace: { createdAt: ISODateTime; demo: boolean };
}

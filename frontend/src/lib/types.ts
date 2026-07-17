export interface User {
  id: number;
  userCode: string;
  username: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  /** User groups this user belongs to (returned by GET /users). */
  groupIds?: number[];
  /** Companies this user belongs to (returned by GET /users). */
  companyIds?: number[];
  /** Branches this user may access (returned by GET /users). */
  branchIds?: number[];
  /** Per-company module assignment (returned by GET /users). */
  moduleAssignments?: { companyId: number; moduleIds: number[] }[];
  defaultModuleId?: number | null;
}

export interface NavItem {
  id: number;
  name: string;
  route: string;
  icon?: string | null;
  objectType?: string | null;
}

export interface NavMenu {
  id: number;
  name: string;
  icon?: string | null;
  objectType?: string | null;
  items: NavItem[];
}

export interface NavDashboard {
  id: number;
  name: string;
  icon?: string | null;
  route: string;
  isDefault: boolean;
  /** null = company-wide dashboard; otherwise the branch it belongs to. */
  branchId?: number | null;
}

export interface NavModule {
  id: number;
  code: string;
  name: string;
  icon?: string | null;
  menus: NavMenu[];
  dashboards?: NavDashboard[];
}

export interface CompanyLite {
  id: number;
  code: string;
  name: string;
  shortName?: string | null;
  legalName?: string | null;
  logo?: string | null;
  isDefault?: boolean;
}

/** A branch as returned in the auth profile / top-bar switcher. */
export interface BranchLite {
  id: number;
  code: string;
  name: string;
}

/** Full branch record (Branch Master drawer). */
export interface Branch {
  id: number;
  companyId: number;
  code: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
  isLocked?: boolean;
}

/** Cost center (per company). */
export interface CostCenter {
  id: number;
  companyId: number;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  isLocked?: boolean;
}

/** Cost object (per company, under a cost center). */
export interface CostObject {
  id: number;
  companyId: number;
  costCenterId: number;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  isLocked?: boolean;
}

export interface Permission {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  lock: boolean;
  unlock: boolean;
  print: boolean;
  downloadPdf: boolean;
  downloadExcel: boolean;
}

export type Permissions = Record<string, Permission>;

export interface LoginResponse {
  token: string;
  user: User;
  companies: CompanyLite[];
  activeCompanyId: number | null;
  branchApplicable: boolean;
  branches: BranchLite[];
  activeBranchId: number | null;
  navigation: NavModule[];
  permissions: Permissions;
}

export interface MeResponse {
  user: User;
  companies: CompanyLite[];
  activeCompanyId: number | null;
  branchApplicable: boolean;
  branches: BranchLite[];
  activeBranchId: number | null;
  navigation: NavModule[];
  permissions: Permissions;
}

export interface Module {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
  isCore: boolean;
  isLocked?: boolean;
  // Companies a (non-core) module is enabled for. Empty/undefined for core.
  companyIds?: number[];
}

export interface Lookup {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  /** Module this lookup belongs to (null = global / all modules). */
  moduleId?: number | null;
  module?: { id: number; name: string } | null;
  isSystem: boolean;
  isLocked?: boolean;
  /** Value count (returned by the list endpoint). */
  _count?: { values: number };
}

export interface LookupValue {
  id: number;
  lookupId: number;
  value: string;
  label: string;
  /** Optional custom name for this value. */
  alias?: string | null;
  /** Free-text remarks (was "extra"). */
  remarks?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
  isLocked?: boolean;
}

export interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
  fractionalUnit: string;
  isActive: boolean;
  isLocked?: boolean;
}

export interface Company {
  id: number;
  code: string;
  name: string;
  shortName?: string | null;
  logo?: string | null;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  // Financial / statutory details
  financialYearStartMonth?: number | null;
  financialYearEndMonth?: number | null;
  booksStartDate?: string | null;
  costCenterApplicable?: boolean;
  costObjectApplicable?: boolean;
  branchApplicable?: boolean;
  currencyId?: number | null;
  cin?: string | null;
  gstin?: string | null;
  pan?: string | null;
  tan?: string | null;
  ptrn?: string | null;
  ptec?: string | null;
  isActive: boolean;
  isLocked?: boolean;
}

export type ObjectType = 'TABLE' | 'FORM' | 'REPORT' | 'DASHBOARD';

export interface ErpObject {
  id: number;
  moduleId: number;
  module?: { id: number; name: string; code?: string } | null;
  author: string;
  objectType: ObjectType;
  objectName: string;
  notes?: string | null;
  showInMenu: boolean;
  nameInMenu?: string | null;
  description?: string | null;
  route?: string | null;
  icon?: string | null;
  help?: boolean | null;
  /** System objects (Cpanel core) are visible only to super admins. */
  isSystem?: boolean;
  /** Locked objects must be unlocked before they can be edited or deleted. */
  isLocked?: boolean;
  createdAt?: string;
  updatedAt?: string;
  revisions?: ObjectRevision[];
}

export interface ObjectRevision {
  id: number;
  objectId: number;
  revisionNumber: number;
  revisedBy: string;
  reason?: string | null;
  changesDone?: string | null;
  createdAt?: string;
}

export interface ObjectListResponse {
  data: ErpObject[];
  total: number;
  page: number;
  pageSize: number;
  counts: { forms: number; reports: number; tables: number; dashboards?: number };
}

// ---- Widgets ----
export type WidgetType = 'METRIC' | 'LINKS' | 'NOTE' | 'EMBED';

export type MetricFormat = 'number' | 'percent' | 'currency';

// Per-widget appearance — colours, fonts, shape. All optional; sensible
// defaults preserve the standard card look.
export type WidgetAccent = 'blue' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';

export interface WidgetStyle {
  accent?: WidgetAccent; // icon-chip colour
  valueColor?: string; // hex override for the value text
  background?: string; // hex card background
  fontFamily?: 'sans' | 'serif' | 'mono';
  fontSize?: 'sm' | 'md' | 'lg' | 'xl'; // value size
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
  shape?: 'rounded' | 'soft' | 'square' | 'pill'; // corner radius
  border?: boolean; // default true
  shadow?: boolean; // default true
}

export interface WidgetConfig {
  metric?: string; // METRIC: the registry key, e.g. 'production.orders.planned'
  text?: string; // NOTE
  url?: string; // EMBED
  height?: number; // EMBED
  hint?: string; // STAT / METRIC subtitle
  icon?: string; // STAT icon name
  style?: WidgetStyle; // appearance overrides
}

// A metric offered for a module's METRIC widgets (builder dropdown).
export interface MetricOption {
  key: string;
  label: string;
  format: MetricFormat;
}

// A computed metric value returned by /widgets/metric-values.
export interface MetricValue {
  value: number;
  format: MetricFormat;
  label: string;
}

export interface WidgetCatalogItem {
  id: number;
  companyId: number;
  moduleId: number;
  code: string;
  name: string;
  description?: string | null;
  type: WidgetType;
  config?: WidgetConfig | null;
  sortOrder: number;
  isActive: boolean;
  isLocked?: boolean;
  module?: { id: number; name: string; code: string } | null;
  _count?: { placements: number };
}

// ---- Dashboards ----

// Header banner appearance. All optional; unset fields fall back to the
// default brand-blue gradient and the standard subtitle.
export type DashboardHeaderTheme =
  | 'blue'
  | 'emerald'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'slate'
  | 'custom';

export interface DashboardHeaderStyle {
  theme?: DashboardHeaderTheme;
  gradientFrom?: string; // hex, used when theme = 'custom'
  gradientTo?: string; // hex, used when theme = 'custom'
  solid?: boolean; // solid fill (gradientFrom) instead of a gradient
  subtitle?: string; // override the default subtitle text
  pattern?: boolean; // decorative circle, default true
  align?: 'left' | 'center';
  size?: 'sm' | 'md' | 'lg'; // banner padding / height
  hidden?: boolean; // hide the banner entirely
}

export interface DashboardWidget {
  widgetId: number;
  code: string;
  name: string;
  description?: string | null;
  type?: WidgetType;
  config?: WidgetConfig | null;
  width: number;
  hidden?: boolean;
  sortOrder: number;
}

export interface DashboardDetail {
  id: number;
  name: string;
  icon?: string | null;
  header?: DashboardHeaderStyle | null;
  moduleId: number;
  module?: { id: number; name: string; code: string } | null;
  isCustomized: boolean;
  widgets: DashboardWidget[];
}

export interface DashboardSummary {
  id: number;
  companyId: number;
  moduleId: number;
  branchId?: number | null;
  branch?: { id: number; name: string } | null;
  name: string;
  icon?: string | null;
  header?: DashboardHeaderStyle | null;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  isLocked?: boolean;
  module?: { id: number; name: string; code: string } | null;
  _count?: { widgets: number };
}

export interface MainMenu {
  id: number;
  moduleId: number;
  sortOrder?: number | null;
  menuName: string;
  objectType?: string | null;
  isUserMenu: boolean;
  icon?: string | null;
  isLocked?: boolean;
}

export interface SubMenu {
  id: number;
  mainMenuId: number;
  objectId?: number | null;
  sortOrder?: number | null;
  subMenuName: string;
  objectType?: string | null;
  description?: string | null;
  route?: string | null;
  icon?: string | null;
  isLocked?: boolean;
}

export interface UserGroup {
  id: number;
  name: string;
  /** Owning company (user groups are company-scoped). */
  companyId?: number;
  description?: string | null;
  isLocked?: boolean;
  /** Modules this group can manage (many-to-many). */
  modules?: Module[];
}

export interface PrivilegeSubMenu {
  id: number;
  subMenuName: string;
  objectType?: string | null;
  canMenu: boolean;
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canLock: boolean;
  canUnlock: boolean;
  canPrint: boolean;
  canDownloadPdf: boolean;
  canDownloadExcel: boolean;
}

export interface PrivilegeNode {
  mainMenu: { id: number; menuName: string; icon?: string | null };
  visible: boolean;
  subMenus: PrivilegeSubMenu[];
}

export interface PrivilegeDashboard {
  id: number;
  name: string;
  icon?: string | null;
  branchId?: number | null;
  branchName?: string | null;
  selected: boolean;
}

export interface PrivilegeModuleGroup {
  module: { id: number; code: string; name: string; icon?: string | null };
  tree: PrivilegeNode[];
  dashboards: PrivilegeDashboard[];
}

export interface PrivilegesResponse {
  group: UserGroup;
  modules: PrivilegeModuleGroup[];
}

export type SecurityType = 'PASSWORD' | 'MAC' | 'MACOTP';

export interface UserGroupRef {
  id: number;
  name: string;
  companyId: number;
}

export interface UserCompanyRef {
  id: number;
  code: string;
  name: string;
  isDefault?: boolean;
  /** Module that loads automatically when this company is active. */
  defaultModuleId?: number | null;
}

export interface AppUser {
  id: number;
  userCode: string;
  username: string;
  name: string;
  email: string;
  mobile?: string | null;
  mobileMac?: string | null;
  webEnabled: boolean;
  mobileEnabled: boolean;
  computerMac?: string | null;
  securityType: SecurityType;
  isSuperAdmin?: boolean;
  isActive: boolean;
  isLocked?: boolean;
  remarks?: string | null;
  groupIds?: number[];
  groups?: UserGroupRef[];
  companyIds?: number[];
  companies?: UserCompanyRef[];
  /** Branches this user may access (flat list across branch-applicable companies). */
  branchIds?: number[];
  /** The user's default branch per company (subset of branchIds, one per company). */
  defaultBranchIds?: number[];
  /** Per-company module assignment + the default module for that company. */
  moduleAssignments?: {
    companyId: number;
    moduleIds: number[];
    defaultModuleId?: number | null;
  }[];
  defaultCompanyId?: number | null;
  defaultModuleId?: number | null;
}

// ---- Inventory: Unit Master (global) ----
export type UnitType = 'SIMPLE' | 'COMPOUND' | 'CHAINING';

/** One rung of a CHAINING unit's ladder (top → bottom): 1 (level above) = quantity × linkUnit. */
export interface UnitChainLink {
  id?: number;
  sequence: number;
  quantity: number;
  linkUnitId: number;
  linkUnit?: { id: number; code: string; name: string; symbol?: string | null } | null;
}

export interface Unit {
  id: number;
  code: string;
  name: string;
  symbol?: string | null;
  type: UnitType;
  /**
   * COMPOUND: the simple base unit and how many base units = 1 of this.
   * CHAINING: the RESOLVED base (the ladder's bottom simple unit) and factor
   * (product of all rung quantities).
   */
  baseUnitId?: number | null;
  baseUnit?: { id: number; code: string; name: string; symbol?: string | null } | null;
  conversionFactor?: number | null;
  /** CHAINING only: the ordered ladder of rungs. */
  chainLinks?: UnitChainLink[];
  decimalPlaces: number;
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory: Category Master (one master for Items + Products) ----
export interface Category {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  /** true = available to every company; otherwise companyIds applies. */
  allCompanies: boolean;
  /** Companies this category is available in (when not allCompanies). */
  companyIds: number[];
  forItem: boolean;
  forProduct: boolean;
  /** Items in this category are packing materials (a kind of item). */
  forPacking?: boolean;
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory: Group Master (multilayer sub-level under a Category) ----
export interface Group {
  id: number;
  categoryId: number;
  category?: { id: number; code: string; name: string } | null;
  /** null = primary group (level 1); otherwise the parent group it sits under. */
  parentGroupId?: number | null;
  parent?: { id: number; code: string; name: string } | null;
  /** 1 = primary group … up to 5. */
  level: number;
  /** true = container that holds sub-groups and cannot hold items/products. */
  subGroupApplicable: boolean;
  code: string;
  name: string;
  description?: string | null;
  allCompanies: boolean;
  companyIds: number[];
  forItem: boolean;
  forProduct: boolean;
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Asset: Category Master (flat; no Item/Product applicability) ----
export interface AssetCategory {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  /** true = available to every company; otherwise companyIds applies. */
  allCompanies: boolean;
  /** Companies this asset category is available in (when not allCompanies). */
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Asset: Group Master (multilayer sub-level under an Asset Category) ----
export interface AssetGroup {
  id: number;
  categoryId: number;
  category?: { id: number; code: string; name: string } | null;
  /** null = primary group (level 1); otherwise the parent group it sits under. */
  parentGroupId?: number | null;
  parent?: { id: number; code: string; name: string } | null;
  /** 1 = primary group … up to 5. */
  level: number;
  /** true = container that holds sub-groups and cannot hold assets. */
  subGroupApplicable: boolean;
  code: string;
  name: string;
  description?: string | null;
  allCompanies: boolean;
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory: HSN Code Master (global; GST rates) ----
export interface HsnCode {
  id: number;
  code: string;
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory: Item Master ----
interface MasterRef {
  id: number;
  code: string;
  name: string;
  symbol?: string | null;
}

export interface Item {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  categoryId?: number | null;
  category?: MasterRef | null;
  groupId?: number | null;
  group?: MasterRef | null;
  unitId: number;
  unit?: MasterRef | null;
  /** Last purchase price — refreshed on every purchase. */
  lastPurchasePrice: number;
  /** ISO datetime of the last purchase; null = never purchased. */
  lastPurchaseDate?: string | null;
  boxQty: number;
  boxUnitId?: number | null;
  boxUnit?: MasterRef | null;
  hsnCodeId?: number | null;
  hsnCode?: { id: number; code: string; description: string } | null;
  minimumStock: number;
  maximumStock: number;
  reorderLevel: number;
  leadTime: number;
  shelfLife: number;
  allCompanies: boolean;
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory: Product Master + double BOM ----
export interface ProductBomLine {
  id?: number;
  itemId: number;
  quantity: number;
  unitId: number;
  sequence?: number;
  item?: MasterRef | null;
  unit?: MasterRef | null;
}

export type ProcessTimeUnit = 'MIN' | 'HR';

/// One step of a product's production process flow: an ordered stage with the
/// time it takes and the machine (Asset) it runs on. `machineId` is a plain
/// Asset id (production-line machine).
export interface ProcessManpower {
  id?: number;
  /** Plain HR Designation id (rate/hour read from the designation master). */
  designationId: number;
  workerCount: number;
}

export interface ProductProcess {
  id?: number;
  sequence?: number;
  name: string;
  description?: string | null;
  timeValue: number;
  timeUnit: ProcessTimeUnit;
  machineId?: number | null;
  /** Manpower assigned to this step (designation + worker count). */
  manpower?: ProcessManpower[];
}

export interface Product {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  /** Product picture URL (sellable products), served under /uploads. */
  imageUrl?: string | null;
  categoryId?: number | null;
  category?: MasterRef | null;
  groupId?: number | null;
  group?: MasterRef | null;
  unitId: number;
  unit?: MasterRef | null;
  /** Form factor: product may be sold unpacked, packed, or both. */
  unpacked: boolean;
  packed: boolean;
  /** false = not sold (selling prices/packing disabled in the form). */
  canSell: boolean;
  /** Cost incurred per unit — the base for each profit %. */
  costPrice: number;
  wholesalePrice: number;
  wholesaleProfitPct: number;
  intercompanyPrice: number;
  intercompanyProfitPct: number;
  retailPrice: number;
  retailProfitPct: number;
  boxQty: number;
  boxUnitId?: number | null;
  boxUnit?: MasterRef | null;
  hsnCodeId?: number | null;
  hsnCode?: { id: number; code: string; description: string } | null;
  shelfLife: number;
  yieldQty: number;
  yieldUnitId?: number | null;
  yieldUnit?: MasterRef | null;
  /** Packed product: the unpacked source products it is packed from (each with a
   *  quantity); per-unit cost is the source product's costPrice. */
  packSources?: {
    id?: number;
    sourceProductId: number;
    quantity: number;
    sequence?: number;
  }[];
  /** Per-branch stocking parameters (min/max/reorder level + lead time in days).
   *  One entry per branch that has been configured. */
  branchStocks?: {
    id?: number;
    branchId: number;
    minStock: number;
    maxStock: number;
    reorderLevel: number;
    leadTimeDays: number;
  }[];
  // BOM costing inputs (material cost is computed from the recipe).
  labourCost: number;
  fuelCost: number;
  overheadCost: number;
  bomMarginPct: number;
  /** Per-yield-unit actual prices set from the recipe editor. Cost is populated
   * from the estimated cost/unit (used in Packing); sales is user-entered (used
   * for the sales invoice). */
  actualCostPrice: number;
  actualSalesPrice: number;
  /** A production (recipe) BOM can be created for this product. */
  hasRecipe: boolean;
  /** A packing BOM can be created for this product. */
  hasPacking: boolean;
  /** This product can be used as an ingredient in another product. */
  isIngredient: boolean;
  allCompanies: boolean;
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
  /** Recipe BOM (ingredients) and packing BOM — edited under Production. */
  recipe: ProductBomLine[];
  packing: ProductBomLine[];
  /** Production process flow (ordered steps with time + machine). */
  processes: ProductProcess[];
}

// ---- CRM: Purchase Orders - IC (inter-company) ----
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PLACED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';
export interface PurchaseOrderLine {
  id: number;
  sequence: number;
  productId: number;
  /** What the BUYER asked for. The supplier never edits this. */
  quantity: number;
  unitId: number;
  /** The supplier's answer. null = not reviewed yet (distinct from a firm 0). */
  acceptedQty?: number | null;
  /** The supplier refused this line; it stays visible, holding nothing. */
  cancelled?: boolean;
  // --- seller-side, present on GET /purchase-orders/:id once submitted ---
  /** Physical stock across every store of the supplier company. */
  stockOnHand?: number;
  /** onHand minus everyone's active holds — what's left to promise. */
  stockAvailable?: number;
  /** Actually held for this line, summed over the batches FEFO split it across. */
  reservedQty?: number;
  /** accepted - reserved: the gap to produce. null until reviewed. */
  balanceQty?: number | null;
  // NO rate. An ICPO carries quantities only — the price is decided by the batch
  // that ships (see SalesOrderLine.rate).
}

/** The viewer's pending action on a document (from the workflow step). */
export interface WorkflowViewerTask {
  taskId: number;
  sequence: number;
  buttonText: string; // label configured on the step — drives the form button
  actionType: string;
  canApprove: boolean; // false = value beyond limit → may only review+forward
  canReject: boolean;
  canCancel: boolean;
  canEdit: boolean;
}
/** A document's workflow state for the viewer. */
export interface PurchaseOrderWorkflow {
  instanceId: number | null;
  status: 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | null;
  currentSequence: number;
  myTask: WorkflowViewerTask | null;
  timeline: WorkflowTimelineEntry[];
}
/** What the viewer may do with the order (draft actions). */
export interface PurchaseOrderViewer {
  isCreator: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  /** The creator may withdraw (cancel) their own in-progress order. */
  canCancel: boolean;
  submitButtonText: string | null;
  /** The seller may set accepted quantities and reserve stock right now. */
  canReview?: boolean;
}

export interface PurchaseOrder {
  id: number;
  companyId: number; // supplier company that owns the order
  orderNo: string;
  orderDate: string;
  /** Requested delivery date & time (ISO); carried to the sales order later. */
  deliveryAt?: string | null;
  orderingCompanyId: number; // requester company
  orderingBranchId?: number | null;
  placedByUserId: number;
  status: PurchaseOrderStatus;
  /** Human-readable status from the workflow step that last acted (if any). */
  workflowStatus?: string | null;
  notes?: string | null;
  workflowInstanceId?: number | null;
  createdAt: string;
  updatedAt?: string;
  lines: PurchaseOrderLine[];
  // Present on the single-order response (GET /purchase-orders/:id).
  /** The sales order the supplier converted this into; null until they do. */
  salesOrderId?: number | null;
  salesOrderNo?: string | null;
  workflow?: PurchaseOrderWorkflow;
  viewer?: PurchaseOrderViewer;
}

// ---- CRM: Sales Orders (ICSO today; LSO joins once Customers exist) ----
export type SalesOrderStatus =
  | 'DRAFT'
  | 'PLACED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface SalesOrderLine {
  id: number;
  sequence: number;
  productId: number;
  /**
   * The batch this line ships from. null = nothing reserved, so the quantity
   * must be produced and has no batch price to inherit.
   */
  batchId?: number | null;
  batchNo?: string | null;
  /**
   * What the ICPO asked for, of this PRODUCT — repeated across the product's
   * split lines, so never sum it. Never edited.
   */
  orderedQty: number;
  /** What THIS line supplies. 0 drops the line. */
  quantity: number;
  unitId: number;
  /**
   * The batch's own selling price, captured when that stock came in — the goods
   * carry it, so it is NOT editable. On a balance line (no batch) it defaults to
   * the master's latest price and IS editable, until production supplies a real
   * batch with a real price.
   */
  rate: number;
}

export interface SalesOrder {
  id: number;
  companyId: number; // the SELLER — owns the order
  /** The group company that raised the ICPO (an ICSO always has one). */
  buyerCompanyId?: number | null;
  buyerBranchId?: number | null;
  /** The ICPO this was converted from. */
  purchaseOrderId?: number | null;
  // The origin PO, snapshotted at conversion.
  poNumber?: string | null;
  poDate?: string | null;
  poDeliveryAt?: string | null;
  poNotes?: string | null;
  orderNo: string;
  orderDate: string;
  /** What the seller commits to (seeded from the buyer's requested date). */
  deliveryAt?: string | null;
  createdByUserId: number;
  status: SalesOrderStatus;
  workflowStatus?: string | null;
  notes?: string | null;
  workflowInstanceId?: number | null;
  createdAt: string;
  updatedAt?: string;
  lines: SalesOrderLine[];
  /** Order value (sum of quantity x rate) — computed by the API. */
  total?: number;
  // Present on the single-order response (GET /sales-orders/:id).
  workflow?: PurchaseOrderWorkflow;
  viewer?: PurchaseOrderViewer;
}

// ---- Purchase: Local Purchase Orders (external suppliers) ----
export type LocalPurchaseOrderStatus =
  | 'DRAFT'
  | 'PLACED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/** Exactly one of itemId / productId is set. */
export interface LocalPurchaseOrderLine {
  id: number;
  sequence: number;
  itemId?: number | null;
  productId?: number | null;
  quantity: number;
  /** Resolved server-side from the item/product master. */
  unitId: number;
  /** Agreed price per unit, snapshotted at order time. */
  rate: number;
}

export interface LocalPurchaseOrder {
  id: number;
  companyId: number; // the BUYER — note the inversion vs PurchaseOrder.companyId
  branchId?: number | null;
  supplierId: number; // -> Accounts Supplier (external vendor)
  orderNo: string;
  orderDate: string;
  /** Requested delivery date & time (ISO). */
  deliveryAt?: string | null;
  /** Store the goods should be delivered to. */
  storeId?: number | null;
  placedByUserId: number;
  status: LocalPurchaseOrderStatus;
  /** Human-readable status from the workflow step that last acted (if any). */
  workflowStatus?: string | null;
  notes?: string | null;
  workflowInstanceId?: number | null;
  createdAt: string;
  updatedAt?: string;
  lines: LocalPurchaseOrderLine[];
  /** Order value (sum of quantity x rate) — computed by the API. */
  total?: number;
  // Present on the single-order response (GET /local-purchase-orders/:id).
  workflow?: PurchaseOrderWorkflow;
  viewer?: PurchaseOrderViewer;
}

// ---- Asset: Asset Master (individual assets/machines) ----
export interface Asset {
  id: number;
  code: string;
  categoryId: number;
  category?: MasterRef | null;
  groupId: number;
  group?: MasterRef | null;
  name: string;            // Machine Name
  minCapacity: number;
  maxCapacity: number;
  capacityUnitId?: number | null;
  perUnitId?: number | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  lifeSpanYears: number;
  purchasedFrom?: string | null;
  purchaseDate?: string | null;   // ISO date
  purchasePrice: number;
  warrantyPeriod?: string | null;
  allCompanies: boolean;
  companyIds: number[];
  status: AssetStatus;
  isProductionLine: boolean;
  costPerHour?: number | null;
  isLocked?: boolean;
}

// Operational availability of a machine (replaces the old active/inactive flag).
export type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'UNDER_REPAIR';

export type AssetBookingStatus =
  | 'PLANNED'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED';

/// A production-line booking: a machine reserved for a product/batch over a time
/// slot on a day. Created/updated from the Production module.
export interface AssetBooking {
  id: number;
  assetId: number;
  productId?: number | null;
  productName: string;
  batchNo?: string | null;
  date: string; // ISO date
  timeFrom: string; // "HH:mm"
  timeTo: string; // "HH:mm"
  status: AssetBookingStatus;
}

// ---- HR: Manpower Category Master (top level: Staff, Workers) ----
export interface HrCategory {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  /** true = available to every company; otherwise companyIds applies. */
  allCompanies: boolean;
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
}

// ---- HR: Manpower Group Master (multilayer sub-level under an HR Category) ----
export interface HrGroup {
  id: number;
  categoryId: number;
  category?: { id: number; code: string; name: string } | null;
  /** null = primary group (level 1); otherwise the parent group it sits under. */
  parentGroupId?: number | null;
  parent?: { id: number; code: string; name: string } | null;
  /** 1 = primary group … up to 5. */
  level: number;
  /** true = container that holds sub-groups and cannot hold designations. */
  subGroupApplicable: boolean;
  code: string;
  name: string;
  description?: string | null;
  allCompanies: boolean;
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
}

// ---- HR: Designation Master (leaf; carries the manpower rate/hour) ----
export interface HrDesignation {
  id: number;
  code: string;
  categoryId: number;
  category?: { id: number; code: string; name: string } | null;
  groupId: number;
  group?: { id: number; code: string; name: string } | null;
  name: string;
  description?: string | null;
  /** Manpower cost rate per hour (used in recipe process costing). */
  ratePerHour?: number | null;
  allCompanies: boolean;
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Workflow Engine ----
export type WorkflowActionType =
  | 'CREATE_APPROVE'
  | 'CREATE_FORWARD'
  | 'APPROVE'
  | 'APPROVE_FORWARD'
  | 'CREATE_REFERENCE'
  | 'REFERENCE'
  | 'REVIEW_FORWARD'
  /** Approve + convert an ICPO into a sales order. Offered only on that form. */
  | 'CONVERT_ICSO';
export type WorkflowApprovalMode = 'FORM' | 'FIELD';
export type WorkflowInstanceStatus =
  | 'IN_PROGRESS'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/** One approval level of a workflow definition (Tab 2). */
/** A reusable document status (name + icon + colour), managed by super admins. */
export interface WorkflowStatus {
  id: number;
  name: string;
  icon?: string | null;
  color?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface WorkflowStep {
  id?: number;
  sequence: number;
  userGroupId?: number | null;
  userIds: number[];
  targetCompanyId?: number | null;
  targetBranchId?: number | null;
  targetModuleId?: number | null;
  action: WorkflowActionType;
  buttonText: string;
  statusLabel?: string | null;
  approvalMode: WorkflowApprovalMode;
  fieldName?: string | null;
  valueFrom?: number | null;
  valueTo?: number | null;
  canCancel: boolean;
  canReject: boolean;
  canEdit: boolean;
  notifyInApp: boolean;
  slaHours?: number | null;
}

/** A workflow definition (Tab 1) bound to a document type. */
export interface WorkflowDefinition {
  id: number;
  name: string;
  companyId: number;
  branchId?: number | null;
  moduleId: number;
  objectId: number;
  isActive: boolean;
  isLocked?: boolean;
  steps: WorkflowStep[];
}

/** A pending approval in the current user's inbox (My Approvals). */
export interface WorkflowTaskItem {
  taskId: number;
  instanceId: number;
  sequence: number;
  canApprove: boolean;
  createdAt: string;
  workflowName: string;
  documentRef?: string | null;
  documentId: number;
  moduleId: number;
  objectId: number;
  amount?: number | null;
  action?: WorkflowActionType;
  buttonText: string;
  canCancel: boolean;
  canReject: boolean;
  canEdit: boolean;
}

export interface WorkflowTimelineEntry {
  id: number;
  sequence: number;
  action: string;
  comment?: string | null;
  userId: number;
  userName: string;
  createdAt: string;
}

export interface WorkflowInstanceDetail {
  id: number;
  status: WorkflowInstanceStatus;
  currentSequence: number;
  documentRef?: string | null;
  documentId: number;
  amount?: number | null;
  startedByName: string;
  timeline: WorkflowTimelineEntry[];
}

export interface WorkflowNotification {
  id: number;
  userId: number;
  instanceId: number;
  taskId?: number | null;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

// ---- Backup & Restore ----
export interface Backup {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  note: string | null;
  createdBy: string | null;
}

// A table that can be backed up / restored on its own.
export interface BackupTableInfo {
  name: string;
  label: string;
  rowCount: number;
}

// A per-table dump file on the server.
export interface TableDump {
  fileName: string;
  table: string;
  tableLabel: string;
  sizeBytes: number;
  createdAt: string;
  note: string | null;
  createdBy: string | null;
}

// Module catalog annotated with per-company enablement.
export interface CompanyModule {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  isCore: boolean;
  enabled: boolean;
  sortOrder: number;
}

// ---- Inventory: Store & stock movements ----
export interface Store {
  id: number;
  companyId: number;
  branchId?: number | null;
  code: string;
  name: string;
  address?: string | null;
  isDefault?: boolean;
  isActive: boolean;
  isLocked?: boolean;
}

export interface OpeningStockLine {
  id: number;
  itemId?: number | null;
  productId?: number | null;
  categoryId?: number | null;
  primaryGroupId?: number | null;
  parentGroupId?: number | null;
  batchNo1?: string | null;
  batchNo2?: string | null;
  expiryDate?: string | null;
  qtyIn: number;
  qtyOut: number;
  unitId: number;
  unitPrice: number;
  intercompanyPrice?: number;
  wholesalePrice?: number;
  retailPrice?: number;
}

export interface OpeningStock {
  id: number;
  companyId: number;
  docNo: string;
  docDate: string;
  storeId: number;
  reference?: string | null;
  notes?: string | null;
  status: string;
  isLocked?: boolean;
  createdAt: string;
  lineCount?: number;
  totalQty?: number;
  lines?: OpeningStockLine[];
}

/** One enriched opening-stock line for the line-grid listing. */
export interface OpeningStockLineRow {
  id: number; // ledger id
  documentId: number;
  docNo: string;
  docDate: string;
  storeId: number;
  storeName: string;
  itemId?: number | null;
  productId?: number | null;
  name: string;
  categoryId?: number | null;
  categoryName?: string | null;
  primaryGroupId?: number | null;
  primaryGroupName?: string | null;
  parentGroupId?: number | null;
  parentGroupName?: string | null;
  batchNo1?: string | null;
  batchNo2?: string | null;
  expiryDate?: string | null;
  qtyIn: number;
  unitId: number;
  unitSymbol?: string | null;
  unitPrice: number;
  isLocked: boolean;
}

// ---- Accounts: Supplier Master ----
export interface Supplier {
  id: number;
  companyId: number;
  code: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory Transactions (Goods Receipt / Delivery / Return / Issue) ----
export type StockTxnKind =
  | 'PURCHASE'
  | 'SALE'
  | 'SALES_RETURN'
  | 'PURCHASE_RETURN'
  | 'CONSUMPTION';

export interface StockTransaction {
  id: number;
  companyId: number;
  branchId?: number | null;
  type: StockTxnKind;
  docNo: string;
  docDate: string;
  storeId: number;
  /** Goods Receipt Note only. */
  supplierId?: number | null;
  purchaseOrderRef?: string | null;
  reference?: string | null;
  notes?: string | null;
  status: string;
  isLocked?: boolean;
  // findOne returns the raw StockLedger rows, which share the line shape.
  lines?: OpeningStockLine[];
}

/** One enriched stock-transaction line for the listing grid. */
export interface StockTransactionLineRow extends OpeningStockLineRow {
  qtyOut: number;
  /** qtyIn for IN types (receipt/return), qtyOut for OUT types (delivery/issue). */
  qty: number;
}

/** One row per stock DOCUMENT for the header-level listing. */
export interface StockDocumentRow {
  id: number; // document id
  docNo: string;
  docDate: string;
  companyId: number;
  companyName: string;
  branchId?: number | null;
  branchName?: string | null;
  storeId: number;
  storeName: string;
  reference?: string | null;
  amount: number;
  transactionType?: string | null;
  transactionSubtype?: string | null;
  isLocked: boolean;
}

export type OpeningStockType =
  | 'ITEM_RAW'
  | 'ITEM_PACKING'
  | 'PRODUCT_PACKED'
  | 'PRODUCT_UNPACKED';

// ---- Document master & numbering ----
export interface DocumentMaster {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  isActive: boolean;
  isLocked?: boolean;
  transactionTypeId?: number | null;
  transactionSubtypeId?: number | null;
  transactionType?: { id: number; label: string } | null;
  transactionSubtype?: { id: number; label: string } | null;
}

export type NumberingRenumber = 'NEVER' | 'MONTHLY' | 'YEARLY';
export type NumberingPeriodPosition = 'BEFORE_SUFFIX' | 'AFTER_SUFFIX';

// ---- Batch Numbering (per company + branch) ----
export type BatchDateFormat = 'YYMMDD' | 'YYYYMMDD';
export type BatchRenumber = 'DAILY' | 'MONTHLY' | 'YEARLY';

export interface BatchNumberingRow {
  branchId: number | null; // null = the company-level rule
  branchName: string;
  configured: boolean;
  prefixEnabled: boolean;
  prefixValue?: string | null;
  dateFormat: BatchDateFormat;
  paddingLength: number;
  startingNo: number;
  renumber: BatchRenumber;
  isLocked: boolean;
  preview: string;
}

export interface DocumentNumberingRow {
  documentId: number;
  documentName: string;
  documentCode: string;
  isSystem: boolean;
  configured: boolean;
  prefixEnabled: boolean;
  prefixValue: string | null;
  startingNo: number;
  suffixEnabled: boolean;
  suffixValue: string | null;
  paddingLength: number;
  renumber: NumberingRenumber;
  periodPosition: NumberingPeriodPosition;
  isLocked: boolean;
  lastNumber: number;
  preview: string;
}

export interface User {
  id: number;
  userCode: string;
  username: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
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
  isSystem: boolean;
  isLocked?: boolean;
}

export interface LookupValue {
  id: number;
  lookupId: number;
  value: string;
  label: string;
  extra?: string | null;
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
  linkUnit?: { id: number; code: string; name: string } | null;
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
  baseUnit?: { id: number; code: string; name: string } | null;
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
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory: Group Master (sub-level under a Category) ----
export interface Group {
  id: number;
  categoryId: number;
  category?: { id: number; code: string; name: string } | null;
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

// ---- Inventory: HSN Code Master (global; GST rates) ----
export interface HsnCode {
  id: number;
  code: string;
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  isActive: boolean;
  isLocked?: boolean;
}

// ---- Inventory: Item Master ----
interface MasterRef {
  id: number;
  code: string;
  name: string;
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
  unitPrice: number;
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

export interface Product {
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
  sellingPrice: number;
  hsnCodeId?: number | null;
  hsnCode?: { id: number; code: string; description: string } | null;
  shelfLife: number;
  yieldQty: number;
  allCompanies: boolean;
  companyIds: number[];
  isActive: boolean;
  isLocked?: boolean;
  /** Recipe BOM (ingredients) and packing BOM — edited under Production. */
  recipe: ProductBomLine[];
  packing: ProductBomLine[];
}

// ---- Backup & Restore ----
export interface Backup {
  fileName: string;
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

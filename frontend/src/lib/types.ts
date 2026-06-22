export interface User {
  id: number;
  userCode: string;
  username: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  defaultModuleId?: number | null;
}

export interface Gadget {
  id: number;
  code: string;
  name: string;
  description?: string | null;
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
}

export interface NavModule {
  id: number;
  code: string;
  name: string;
  icon?: string | null;
  menus: NavMenu[];
  gadgets?: Gadget[];
  dashboards?: NavDashboard[];
}

export interface CompanyLite {
  id: number;
  code: string;
  name: string;
  isDefault?: boolean;
}

export interface Permission {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
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
  navigation: NavModule[];
  permissions: Permissions;
}

export interface MeResponse {
  user: User;
  companies: CompanyLite[];
  activeCompanyId: number | null;
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
  // Companies a (non-core) module is enabled for. Empty/undefined for core.
  companyIds?: number[];
}

export interface Lookup {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
}

export interface LookupValue {
  id: number;
  lookupId: number;
  value: string;
  label: string;
  extra?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
}

export interface Company {
  id: number;
  code: string;
  name: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  taxNumber?: string | null;
  isActive: boolean;
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

// ---- Gadgets ----
export type GadgetType = 'BUILTIN' | 'STAT' | 'LINKS' | 'NOTE' | 'EMBED';

export interface GadgetConfig {
  source?: string; // STAT: what to count
  text?: string; // NOTE
  url?: string; // EMBED
  height?: number; // EMBED
  hint?: string; // STAT subtitle
  icon?: string; // STAT icon name
}

export interface GadgetCatalogItem {
  id: number;
  companyId: number;
  moduleId: number;
  code: string;
  name: string;
  description?: string | null;
  type: GadgetType;
  config?: GadgetConfig | null;
  sortOrder: number;
  isActive: boolean;
  module?: { id: number; name: string; code: string } | null;
  _count?: { placements: number };
}

// ---- Dashboards ----
export interface DashboardWidget {
  gadgetId: number;
  code: string;
  name: string;
  description?: string | null;
  type?: GadgetType;
  config?: GadgetConfig | null;
  width: number;
  hidden?: boolean;
  sortOrder: number;
}

export interface DashboardDetail {
  id: number;
  name: string;
  icon?: string | null;
  moduleId: number;
  module?: { id: number; name: string; code: string } | null;
  userGroup?: { id: number; name: string } | null;
  isCustomized: boolean;
  widgets: DashboardWidget[];
}

export interface DashboardSummary {
  id: number;
  companyId: number;
  moduleId: number;
  userGroupId?: number | null;
  name: string;
  icon?: string | null;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
  module?: { id: number; name: string; code: string } | null;
  userGroup?: { id: number; name: string } | null;
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
}

export interface UserGroup {
  id: number;
  name: string;
  description?: string | null;
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
  canPrint: boolean;
  canDownloadPdf: boolean;
  canDownloadExcel: boolean;
}

export interface PrivilegeNode {
  mainMenu: { id: number; menuName: string; icon?: string | null };
  visible: boolean;
  subMenus: PrivilegeSubMenu[];
}

export interface PrivilegeGadget {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  selected: boolean;
}

export interface PrivilegeModuleGroup {
  module: { id: number; code: string; name: string; icon?: string | null };
  tree: PrivilegeNode[];
  gadgets: PrivilegeGadget[];
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
  remarks?: string | null;
  groupIds?: number[];
  groups?: UserGroupRef[];
  companyIds?: number[];
  companies?: UserCompanyRef[];
  /** Per-company module assignment + the default module for that company. */
  moduleAssignments?: {
    companyId: number;
    moduleIds: number[];
    defaultModuleId?: number | null;
  }[];
  defaultCompanyId?: number | null;
  defaultModuleId?: number | null;
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

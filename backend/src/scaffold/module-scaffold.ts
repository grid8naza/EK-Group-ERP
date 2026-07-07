import { ObjectType, Prisma } from '@prisma/client';
import {
  CPANEL_SUBS,
  seedCpanelDefaults,
} from '../modules/company/company-provisioning';
import {
  INVENTORY_SUBS,
  INVENTORY_REPORT_MENUS,
  PRODUCTION_SUBS,
  seedInventoryDefaults,
  seedProductionDefaults,
} from '../modules/unit/inventory-provisioning';
import {
  ASSET_SUBS,
  ASSET_REPORT_MENUS,
  seedAssetDefaults,
} from '../modules/asset-category/asset-provisioning';
import { HR_SUBS } from '../modules/hr-category/hr-provisioning';
import { WORKFLOW_SUBS } from '../modules/workflow/workflow-provisioning';
import { CRM_SUBS } from '../modules/crm/crm-provisioning';

/**
 * Single source of truth for every module and the menus/screens it ships with.
 *
 * Adding a new module or screen = edit this list. On every app start the
 * scaffold sync (scaffold.sync.ts) makes each developer's database match this
 * declaration — additively, never destructively — so pulling code is enough; no
 * manual SQL or reseed. Schema changes are handled separately by `prisma db
 * push` on container start.
 */

export interface ScaffoldSub {
  name: string;
  route: string;
  icon: string;
  order: number;
  /**
   * Screen kind — decides which privilege actions apply (forms use
   * Add/Edit/Delete/Lock/Unlock; reports use Print/PDF/Excel). Defaults to FORM.
   */
  objectType?: ObjectType;
  /**
   * Super-admin-only screen: the menu + Object Master entry are still created,
   * but the Administrators group is NOT granted privileges, so only super admins
   * (who bypass the privilege gate) see it. Used for the per-module Lookups
   * screens, which manage that module's reference data.
   */
  superAdminOnly?: boolean;
}

export interface ModuleScaffold {
  /** Unique module code (matches Module.code). */
  code: string;
  name: string;
  icon: string;
  sortOrder: number;
  description?: string;
  /** Core modules are universal (super-admin) and provisioned for every company. */
  isCore?: boolean;
  /**
   * User modules are NORMALLY register-only: the module appears in Module Master
   * but stays disabled per company until an admin enables it (menus are created
   * only where enabled). Set this to enable the module for every company on
   * boot — kept for Inventory's existing behaviour; leave off for new modules.
   */
  autoEnable?: boolean;
  /** The main menu that hosts this module's screens (one per company). */
  menu?: { name: string; icon: string };
  /** The module's screens. */
  subs?: ScaffoldSub[];
  /**
   * Additional named main menus for this module, beyond the primary `menu`
   * (e.g. a separate "Inventory Report" menu alongside "Inventory"). Each is its
   * own MainMenu row, matched by name so it coexists with the primary.
   */
  extraMenus?: { name: string; icon: string; subs: ScaffoldSub[] }[];
  /** Cpanel screens are system + locked Object Master entries. */
  objectSystem?: boolean;
  /** One-time data seed for the module (guards internally; safe every boot). */
  seedData?: (prisma: Prisma.TransactionClient) => Promise<void>;
}

export const MODULE_SCAFFOLDS: ModuleScaffold[] = [
  {
    code: 'CPANEL',
    name: 'Cpanel',
    icon: 'settings',
    sortOrder: 1,
    isCore: true,
    description: 'Control panel: configure the whole application.',
    menu: { name: 'Cpanel', icon: 'settings' },
    subs: CPANEL_SUBS,
    objectSystem: true,
    seedData: seedCpanelDefaults,
  },
  {
    code: 'CRM',
    name: 'CRM',
    icon: 'users',
    sortOrder: 2,
    description: 'Customer relationship management.',
    autoEnable: true, // on for every company (requesters place, suppliers receive)
    menu: { name: 'CRM', icon: 'users' },
    subs: CRM_SUBS,
  },
  {
    code: 'ACCOUNTS',
    name: 'Accounts',
    icon: 'wallet',
    sortOrder: 3,
    description: 'Finance & accounting.',
  },
  {
    code: 'INVENTORY',
    name: 'Inventory',
    icon: 'package',
    sortOrder: 4,
    description: 'Stock & inventory.',
    autoEnable: true, // preserves Inventory's current "on for every company" behaviour
    menu: { name: 'Inventory', icon: 'package' },
    subs: INVENTORY_SUBS,
    extraMenus: INVENTORY_REPORT_MENUS,
    seedData: seedInventoryDefaults,
  },
  {
    code: 'HR',
    name: 'Human Resources',
    icon: 'id-card',
    sortOrder: 5,
    description: 'HR & employees — manpower category, group & designation masters.',
    autoEnable: true, // on for every company so the manpower masters appear
    menu: { name: 'Human Resources', icon: 'id-card' },
    subs: HR_SUBS,
  },
  {
    code: 'PRODUCTION',
    name: 'Production',
    icon: 'factory',
    sortOrder: 6,
    description: 'Manufacturing & production orders.',
    autoEnable: true, // on for every company so the Recipe Master screen appears
    menu: { name: 'Production', icon: 'factory' },
    subs: PRODUCTION_SUBS,
    seedData: seedProductionDefaults,
  },
  {
    code: 'ASSET',
    name: 'Asset',
    icon: 'building-2',
    sortOrder: 7,
    description: 'Fixed assets — asset category, group & asset masters.',
    autoEnable: true, // on for every company, like Inventory
    menu: { name: 'Asset', icon: 'building-2' },
    subs: ASSET_SUBS,
    extraMenus: ASSET_REPORT_MENUS,
    seedData: seedAssetDefaults,
  },
  {
    code: 'WORKFLOW',
    name: 'Workflow',
    icon: 'git-branch',
    sortOrder: 8,
    description: 'Document approval routing — the approver inbox (setup is in Cpanel).',
    autoEnable: true, // on for every company so approvers see their inbox
    menu: { name: 'Workflow', icon: 'git-branch' },
    subs: WORKFLOW_SUBS,
  },
];

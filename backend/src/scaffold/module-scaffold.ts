import { Prisma } from '@prisma/client';
import { CPANEL_SUBS } from '../modules/company/company-provisioning';
import {
  INVENTORY_SUBS,
  seedDefaultUnits,
} from '../modules/unit/inventory-provisioning';

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
  },
  {
    code: 'CRM',
    name: 'CRM',
    icon: 'users',
    sortOrder: 2,
    description: 'Customer relationship management.',
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
    seedData: seedDefaultUnits,
  },
  {
    code: 'HR',
    name: 'Human Resources',
    icon: 'id-card',
    sortOrder: 5,
    description: 'HR & employees.',
  },
  {
    code: 'PRODUCTION',
    name: 'Production',
    icon: 'factory',
    sortOrder: 6,
    description: 'Manufacturing & production orders.',
  },
];

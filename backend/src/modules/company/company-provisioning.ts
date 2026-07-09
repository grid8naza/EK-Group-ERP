import { ObjectType, Prisma } from '@prisma/client';

/**
 * Per-company Cpanel provisioning. This is the single source of truth for the
 * Cpanel scaffold every company needs, shared by the database seed and the
 * runtime "create company" endpoint so the two never drift apart.
 */

// Cpanel sub-menu screens (shared routes; data is company-scoped at runtime).
export const CPANEL_SUBS = [
  { name: 'Object Master', route: '/cpanel/objects', icon: 'database', order: 1 },
  { name: 'Module Master', route: '/cpanel/modules', icon: 'layers', order: 2 },
  { name: 'Menu Setup', route: '/cpanel/menus', icon: 'menu', order: 3 },
  { name: 'User Groups', route: '/cpanel/user-groups', icon: 'shield', order: 4 },
  { name: 'Dashboards', route: '/cpanel/dashboards', icon: 'layout-dashboard', order: 5 },
  { name: 'Widgets', route: '/cpanel/widgets', icon: 'box', order: 6 },
  { name: 'Company Master', route: '/cpanel/companies', icon: 'building', order: 7 },
  { name: 'Currency Master', route: '/cpanel/currencies', icon: 'wallet', order: 8 },
  { name: 'Lookups', route: '/cpanel/lookups', icon: 'list', order: 9 },
  { name: 'Users & Data Security', route: '/cpanel/users', icon: 'users', order: 10 },
  { name: 'Backup & Restore', route: '/cpanel/backup', icon: 'database-backup', order: 11 },
  { name: 'Login Screen Setup', route: '/cpanel/login-screen', icon: 'image', order: 12 },
  { name: 'Workflow Setup', route: '/cpanel/workflows', icon: 'git-branch', order: 13 },
  { name: 'Approval Statuses', route: '/cpanel/approval-statuses', icon: 'shieldcheck', order: 14 },
  { name: 'Software Information', route: '/cpanel/software-info', icon: 'info', order: 15 },
];

export interface ProvisionResult {
  adminGroup: { id: number };
  cpanelMain: { id: number };
  cpanelSubIds: number[];
}

/**
 * Scaffolds the Cpanel module for a company: the "Cpanel" main menu and its
 * sub-menus, and an "Administrators" group with full Cpanel privileges.
 *
 * Dashboards and widgets are NOT auto-created — admins build them per module
 * from the Dashboards / Widgets screens, then grant them to groups.
 *
 * Idempotent: a company that already has a Cpanel main menu is left untouched
 * and `null` is returned.
 */
export async function provisionCompanyCpanel(
  prisma: Prisma.TransactionClient,
  companyId: number,
): Promise<ProvisionResult | null> {
  const cpanel = await prisma.module.findUnique({ where: { code: 'CPANEL' } });
  if (!cpanel) {
    throw new Error('CPANEL module not found — seed the database first.');
  }
  const cpanelId = cpanel.id;

  // Idempotency guard: never double-provision a company.
  const existing = await prisma.mainMenu.findFirst({
    where: { companyId, moduleId: cpanelId, menuName: 'Cpanel' },
  });
  if (existing) return null;

  // ---- Cpanel main menu + sub-menus ----
  const cpanelMain = await prisma.mainMenu.create({
    data: {
      companyId,
      moduleId: cpanelId,
      menuName: 'Cpanel',
      sortOrder: 1,
      objectType: ObjectType.FORM,
      isUserMenu: true,
      icon: 'settings',
    },
  });
  // Sub-menus, batched. createMany doesn't return ids, so read them back
  // (ordered) for the privilege rows below.
  await prisma.subMenu.createMany({
    data: CPANEL_SUBS.map((s) => ({
      mainMenuId: cpanelMain.id,
      subMenuName: s.name,
      route: s.route,
      icon: s.icon,
      sortOrder: s.order,
      objectType: ObjectType.FORM,
    })),
  });
  const cpanelSubIds = (
    await prisma.subMenu.findMany({
      where: { mainMenuId: cpanelMain.id },
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    })
  ).map((s) => s.id);

  // ---- Administrators group with full Cpanel privileges ----
  const adminGroup = await prisma.userGroup.create({
    data: {
      companyId,
      name: 'Administrators',
      description: 'Full access to enabled modules.',
    },
  });
  await prisma.userGroupModule.create({
    data: { userGroupId: adminGroup.id, moduleId: cpanelId },
  });
  await prisma.groupMainMenuAccess.create({
    data: { userGroupId: adminGroup.id, mainMenuId: cpanelMain.id, visible: true },
  });
  await prisma.groupSubMenuPrivilege.createMany({
    data: cpanelSubIds.map((subMenuId) => ({
      userGroupId: adminGroup.id,
      subMenuId,
      canMenu: true,
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canLock: true,
      canUnlock: true,
    })),
  });

  return { adminGroup, cpanelMain, cpanelSubIds };
}

/**
 * Idempotent back-fill for Cpanel screens added to CPANEL_SUBS *after* a company
 * was first provisioned. Fresh installs get every screen via
 * provisionCompanyCpanel; this brings already-provisioned companies up to date
 * (e.g. when "Backup & Restore" is added) without a reseed.
 *
 * For each existing company's Cpanel main menu it creates any missing sub-menu
 * (matched by route) and grants the Administrators group the standard
 * privileges. It also back-fills any missing GLOBAL Object Master entries.
 *
 * Safe to run on every boot: existing rows are left untouched.
 */
/** @deprecated Superseded by the unified scaffold sync (src/scaffold/scaffold.sync.ts). No longer wired. */
export async function backfillCpanelScaffold(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const cpanel = await prisma.module.findUnique({ where: { code: 'CPANEL' } });
  if (!cpanel) return; // not seeded yet
  const cpanelId = cpanel.id;

  // ---- Global Object Master entries (one per screen, company-independent) ----
  const existingObjectRoutes = new Set(
    (
      await prisma.objectMaster.findMany({
        where: { moduleId: cpanelId, objectType: ObjectType.FORM },
        select: { route: true },
      })
    ).map((o) => o.route),
  );
  for (const s of CPANEL_SUBS) {
    if (existingObjectRoutes.has(s.route)) continue;
    await prisma.objectMaster.create({
      data: {
        moduleId: cpanelId,
        author: 'System',
        objectType: ObjectType.FORM,
        objectName: s.name,
        nameInMenu: s.name,
        showInMenu: true,
        route: s.route,
        icon: s.icon,
        isSystem: true,
        isLocked: true,
      },
    });
  }

  // ---- Per-company sub-menus + Administrators privileges ----
  const cpanelMains = await prisma.mainMenu.findMany({
    where: { moduleId: cpanelId, menuName: 'Cpanel' },
    include: { subMenus: { select: { route: true } } },
  });

  for (const main of cpanelMains) {
    const have = new Set(main.subMenus.map((s) => s.route));
    const missing = CPANEL_SUBS.filter((s) => !have.has(s.route));
    if (missing.length === 0) continue;

    await prisma.subMenu.createMany({
      data: missing.map((s) => ({
        mainMenuId: main.id,
        subMenuName: s.name,
        route: s.route,
        icon: s.icon,
        sortOrder: s.order,
        objectType: ObjectType.FORM,
      })),
    });

    // Grant the company's Administrators group the standard privileges on the
    // newly created sub-menus (mirrors provisionCompanyCpanel).
    const adminGroup = await prisma.userGroup.findFirst({
      where: { companyId: main.companyId, name: 'Administrators' },
      select: { id: true },
    });
    if (!adminGroup) continue;

    const newSubs = await prisma.subMenu.findMany({
      where: {
        mainMenuId: main.id,
        route: { in: missing.map((s) => s.route) },
      },
      select: { id: true },
    });
    await prisma.groupSubMenuPrivilege.createMany({
      data: newSubs.map((sub) => ({
        userGroupId: adminGroup.id,
        subMenuId: sub.id,
        canMenu: true,
        canView: true,
        canAdd: true,
        canEdit: true,
        canDelete: true,
        canLock: true,
        canUnlock: true,
      })),
      skipDuplicates: true,
    });
  }
}

// Codes of the reference lookups that belong to the Cpanel module. Seeded
// module-less in older databases; this re-homes them so they only appear in
// Cpanel's Lookups screen (strict per-module isolation).
const CPANEL_LOOKUP_CODES = ['DEVELOPERS', 'ICONS'];

/**
 * One-time Cpanel data seed (safe to run every boot). Re-homes the global
 * Developers/Icons lookups under the Cpanel module so a module's lookup values
 * never surface in another module's Lookups screen.
 */
export async function seedCpanelDefaults(
  prisma: Prisma.TransactionClient,
): Promise<void> {
  const cpanel = await prisma.module.findUnique({
    where: { code: 'CPANEL' },
    select: { id: true },
  });
  if (!cpanel) return; // catalog not synced yet

  // Only touch lookups still unassigned — never override an admin's later choice.
  await prisma.lookup.updateMany({
    where: { code: { in: CPANEL_LOOKUP_CODES }, moduleId: null },
    data: { moduleId: cpanel.id },
  });
}

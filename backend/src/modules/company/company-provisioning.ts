import { ObjectType, PrismaClient } from '@prisma/client';

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
  { name: 'Gadgets', route: '/cpanel/gadgets', icon: 'box', order: 6 },
  { name: 'Company Master', route: '/cpanel/companies', icon: 'building', order: 7 },
  { name: 'Lookups', route: '/cpanel/lookups', icon: 'list', order: 8 },
  { name: 'Users & Data Security', route: '/cpanel/users', icon: 'users', order: 9 },
];

export const CPANEL_GADGETS = [
  { code: 'USERS_COUNT', name: 'Users', description: 'Total system users', width: 1 },
  { code: 'GROUPS_COUNT', name: 'User Groups', description: 'Privilege groups', width: 1 },
  { code: 'MODULES_COUNT', name: 'Modules', description: 'Enabled modules', width: 1 },
  { code: 'COMPANIES_COUNT', name: 'Companies', description: 'Registered companies', width: 1 },
  { code: 'FORMS_COUNT', name: 'Forms', description: 'Form objects', width: 1 },
  { code: 'REPORTS_COUNT', name: 'Reports', description: 'Report objects', width: 1 },
  { code: 'TABLES_COUNT', name: 'Tables', description: 'Table objects', width: 1 },
  { code: 'RECENT_OBJECTS', name: 'Recent Objects', description: 'Latest objects added', width: 2 },
  { code: 'QUICK_LINKS', name: 'Quick Links', description: 'Shortcuts to admin screens', width: 2 },
  { code: 'ACCOUNT_INFO', name: 'Account', description: 'Your account details', width: 2 },
];

const ADMIN_DASH_WIDGETS = [
  'USERS_COUNT',
  'GROUPS_COUNT',
  'MODULES_COUNT',
  'COMPANIES_COUNT',
  'RECENT_OBJECTS',
  'QUICK_LINKS',
];
const OBJECTS_DASH_WIDGETS = [
  'FORMS_COUNT',
  'REPORTS_COUNT',
  'TABLES_COUNT',
  'RECENT_OBJECTS',
];

export interface ProvisionResult {
  adminGroup: { id: number };
  cpanelMain: { id: number };
  cpanelSubIds: number[];
  cpanelGadgetIds: number[];
}

/**
 * Scaffolds the Cpanel module for a company: the "Cpanel" main menu and its
 * sub-menus, the Cpanel gadgets, an "Administrators" group with full Cpanel
 * privileges, and the Admin Overview / Objects Overview dashboards.
 *
 * Idempotent: a company that already has a Cpanel main menu is left untouched
 * and `null` is returned.
 */
export async function provisionCompanyCpanel(
  prisma: PrismaClient,
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
  const cpanelSubIds: number[] = [];
  for (const s of CPANEL_SUBS) {
    const sub = await prisma.subMenu.create({
      data: {
        mainMenuId: cpanelMain.id,
        subMenuName: s.name,
        route: s.route,
        icon: s.icon,
        sortOrder: s.order,
        objectType: ObjectType.FORM,
      },
    });
    cpanelSubIds.push(sub.id);
  }

  // ---- Cpanel gadgets ----
  const cpanelGadgetIds: number[] = [];
  for (const [i, g] of CPANEL_GADGETS.entries()) {
    const rec = await prisma.gadget.create({
      data: {
        companyId,
        moduleId: cpanelId,
        code: g.code,
        name: g.name,
        description: g.description,
        sortOrder: i + 1,
      },
    });
    cpanelGadgetIds.push(rec.id);
  }

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
  for (const subId of cpanelSubIds) {
    await prisma.groupSubMenuPrivilege.create({
      data: {
        userGroupId: adminGroup.id,
        subMenuId: subId,
        canMenu: true,
        canView: true,
        canAdd: true,
        canEdit: true,
        canDelete: true,
      },
    });
  }
  for (const gid of cpanelGadgetIds) {
    await prisma.groupGadget.create({
      data: { userGroupId: adminGroup.id, gadgetId: gid },
    });
  }

  // ---- Dashboards (Admin Overview + Objects Overview) ----
  // Admin Overview links to the global Admin Overview DASHBOARD object.
  const dashObj = await prisma.objectMaster.findFirst({
    where: { objectType: ObjectType.DASHBOARD, objectName: 'Admin Overview' },
  });
  const adminDash = await prisma.dashboard.create({
    data: {
      companyId,
      moduleId: cpanelId,
      userGroupId: adminGroup.id,
      objectId: dashObj?.id ?? null,
      name: 'Admin Overview',
      icon: 'layout-dashboard',
      sortOrder: 1,
      isDefault: true,
    },
  });
  await addWidgets(prisma, adminDash.id, companyId, cpanelId, ADMIN_DASH_WIDGETS);

  const objectsDash = await prisma.dashboard.create({
    data: {
      companyId,
      moduleId: cpanelId,
      userGroupId: adminGroup.id,
      name: 'Objects Overview',
      icon: 'database',
      sortOrder: 2,
    },
  });
  await addWidgets(
    prisma,
    objectsDash.id,
    companyId,
    cpanelId,
    OBJECTS_DASH_WIDGETS,
  );

  return { adminGroup, cpanelMain, cpanelSubIds, cpanelGadgetIds };
}

/** Attach the gadgets named by `codes` to a dashboard, in order. */
async function addWidgets(
  prisma: PrismaClient,
  dashboardId: number,
  companyId: number,
  moduleId: number,
  codes: string[],
): Promise<void> {
  for (const [i, code] of codes.entries()) {
    const gadget = await prisma.gadget.findFirst({
      where: { companyId, moduleId, code },
    });
    if (!gadget) continue;
    const meta = CPANEL_GADGETS.find((x) => x.code === code);
    await prisma.dashboardWidget.create({
      data: {
        dashboardId,
        gadgetId: gadget.id,
        sortOrder: i + 1,
        width: meta?.width ?? 1,
      },
    });
  }
}

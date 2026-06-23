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
  { name: 'Gadgets', route: '/cpanel/gadgets', icon: 'box', order: 6 },
  { name: 'Company Master', route: '/cpanel/companies', icon: 'building', order: 7 },
  { name: 'Currency Master', route: '/cpanel/currencies', icon: 'wallet', order: 8 },
  { name: 'Lookups', route: '/cpanel/lookups', icon: 'list', order: 9 },
  { name: 'Users & Data Security', route: '/cpanel/users', icon: 'users', order: 10 },
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

  // ---- Cpanel gadgets (batched) ----
  await prisma.gadget.createMany({
    data: CPANEL_GADGETS.map((g, i) => ({
      companyId,
      moduleId: cpanelId,
      code: g.code,
      name: g.name,
      description: g.description,
      sortOrder: i + 1,
    })),
  });
  // Read ids back keyed by code, so dashboards can reference them without a
  // per-widget lookup query.
  const gadgetIdByCode = new Map(
    (
      await prisma.gadget.findMany({
        where: { companyId, moduleId: cpanelId },
        select: { id: true, code: true },
      })
    ).map((g) => [g.code, g.id]),
  );
  const cpanelGadgetIds = CPANEL_GADGETS.map(
    (g) => gadgetIdByCode.get(g.code),
  ).filter((id): id is number => id != null);

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
    })),
  });
  await prisma.groupGadget.createMany({
    data: cpanelGadgetIds.map((gadgetId) => ({
      userGroupId: adminGroup.id,
      gadgetId,
    })),
  });

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
  await addWidgets(prisma, adminDash.id, gadgetIdByCode, ADMIN_DASH_WIDGETS);

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
  await addWidgets(prisma, objectsDash.id, gadgetIdByCode, OBJECTS_DASH_WIDGETS);

  return { adminGroup, cpanelMain, cpanelSubIds, cpanelGadgetIds };
}

/**
 * Attach the gadgets named by `codes` to a dashboard, in order, in one batch.
 * Gadget ids are looked up from the provided code→id map (no DB round-trips).
 */
async function addWidgets(
  prisma: Prisma.TransactionClient,
  dashboardId: number,
  gadgetIdByCode: Map<string, number>,
  codes: string[],
): Promise<void> {
  const data = codes
    .map((code, i) => {
      const gadgetId = gadgetIdByCode.get(code);
      if (gadgetId == null) return null;
      const meta = CPANEL_GADGETS.find((x) => x.code === code);
      return { dashboardId, gadgetId, sortOrder: i + 1, width: meta?.width ?? 1 };
    })
    .filter((w): w is NonNullable<typeof w> => w != null);
  if (data.length) await prisma.dashboardWidget.createMany({ data });
}

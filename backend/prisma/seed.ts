/* eslint-disable no-console */
import { PrismaClient, ObjectType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Cpanel sub-menu screens (shared routes; data is company-scoped at runtime).
const CPANEL_SUBS = [
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

const CPANEL_GADGETS = [
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

const CRM_GADGETS = [
  { code: 'CRM_ENQUIRIES', name: 'Enquiries', description: 'Total enquiry objects', width: 1 },
  { code: 'CRM_WELCOME', name: 'Welcome', description: 'CRM module overview', width: 2 },
  { code: 'CRM_QUICK_LINKS', name: 'Quick Links', description: 'CRM shortcuts', width: 2 },
];

async function main() {
  console.log('Seeding Erp Grid8 (multi-company)…');

  if ((await prisma.company.count()) > 0) {
    console.log('Database already seeded — skipping.');
    return;
  }

  // -------------------------------------------------------------------------
  // Module catalog (global). Enablement is per-company below.
  // -------------------------------------------------------------------------
  const moduleDefs = [
    { code: 'CPANEL', name: 'Cpanel', icon: 'settings', sortOrder: 1, isCore: true, isActive: true, description: 'Control panel: configure the whole application.' },
    { code: 'CRM', name: 'CRM', icon: 'users', sortOrder: 2, isActive: true, description: 'Customer relationship management.' },
    { code: 'ACCOUNTS', name: 'Accounts', icon: 'wallet', sortOrder: 3, isActive: true, description: 'Finance & accounting.' },
    { code: 'INVENTORY', name: 'Inventory', icon: 'package', sortOrder: 4, isActive: true, description: 'Stock & inventory.' },
    { code: 'HR', name: 'Human Resources', icon: 'id-card', sortOrder: 5, isActive: true, description: 'HR & employees.' },
  ];
  const modules: Record<string, number> = {};
  for (const m of moduleDefs) {
    const rec = await prisma.module.create({ data: m });
    modules[m.code] = rec.id;
  }

  // -------------------------------------------------------------------------
  // Lookups (global) — Developers, Icons.
  // -------------------------------------------------------------------------
  const devLookup = await prisma.lookup.create({
    data: { code: 'DEVELOPERS', name: 'Developers', description: 'Developer / author names', isSystem: true },
  });
  for (const [i, value] of ['Pavani', 'Vismaya', 'Ramesh', 'Jose', 'Dhanya'].entries()) {
    await prisma.lookupValue.create({ data: { lookupId: devLookup.id, value, label: value, sortOrder: i + 1 } });
  }
  const iconLookup = await prisma.lookup.create({
    data: { code: 'ICONS', name: 'Icons', description: 'Selectable menu icons (lucide names)', isSystem: true },
  });
  for (const [i, value] of ['settings', 'users', 'list', 'database', 'building', 'shield', 'menu', 'wallet', 'layout-dashboard'].entries()) {
    await prisma.lookupValue.create({ data: { lookupId: iconLookup.id, value, label: value, sortOrder: i + 1 } });
  }

  // -------------------------------------------------------------------------
  // Per-company configuration helper.
  // -------------------------------------------------------------------------
  async function seedCompany(opts: {
    code: string;
    name: string;
    legalName: string;
    city: string;
    enabledModules: string[];
    author: string;
  }) {
    const company = await prisma.company.create({
      data: {
        code: opts.code,
        name: opts.name,
        legalName: opts.legalName,
        email: `info@${opts.code.toLowerCase()}.local`,
        phone: '+91 90000 00000',
        city: opts.city,
        state: 'Kerala',
        country: 'India',
      },
    });
    const cid = company.id;

    // Enable the chosen modules for this company.
    for (const [i, code] of opts.enabledModules.entries()) {
      await prisma.companyModule.create({
        data: { companyId: cid, moduleId: modules[code], sortOrder: i + 1, isActive: true },
      });
    }

    // ---- Cpanel objects + menu ----
    const cpanelId = modules['CPANEL'];
    await prisma.objectMaster.createMany({
      data: [
        { companyId: cid, moduleId: cpanelId, objectName: 'in_objectlist', objectType: ObjectType.TABLE, author: opts.author, showInMenu: false, notes: 'Details of all objects in this project' },
        { companyId: cid, moduleId: cpanelId, objectName: 'fm_objectmaster', objectType: ObjectType.FORM, author: opts.author, nameInMenu: 'Object Master', showInMenu: true, route: '/cpanel/objects', icon: 'database' },
      ],
    });

    const cpanelMain = await prisma.mainMenu.create({
      data: { companyId: cid, moduleId: cpanelId, menuName: 'Cpanel', sortOrder: 1, objectType: ObjectType.FORM, isUserMenu: true, icon: 'settings' },
    });
    const cpanelSubIds: number[] = [];
    for (const s of CPANEL_SUBS) {
      const sub = await prisma.subMenu.create({
        data: { mainMenuId: cpanelMain.id, subMenuName: s.name, route: s.route, icon: s.icon, sortOrder: s.order, objectType: ObjectType.FORM },
      });
      cpanelSubIds.push(sub.id);
    }

    // ---- Cpanel gadgets ----
    const cpanelGadgetIds: number[] = [];
    for (const [i, g] of CPANEL_GADGETS.entries()) {
      const rec = await prisma.gadget.create({
        data: { companyId: cid, moduleId: cpanelId, code: g.code, name: g.name, description: g.description, sortOrder: i + 1 },
      });
      cpanelGadgetIds.push(rec.id);
    }

    // ---- CRM objects + menu + gadgets (if enabled) ----
    let crmMain: { id: number } | null = null;
    let crmSubIds: number[] = [];
    let crmGadgetIds: number[] = [];
    if (opts.enabledModules.includes('CRM')) {
      const crmId = modules['CRM'];
      await prisma.objectMaster.createMany({
        data: [
          { companyId: cid, moduleId: crmId, objectName: 'fm_amcenquiry', objectType: ObjectType.FORM, author: opts.author, nameInMenu: 'Enquiry AMC', showInMenu: true, route: '/crm/enquiry/enquiry-amc', icon: 'list' },
          { companyId: cid, moduleId: crmId, objectName: 'rp_attendance', objectType: ObjectType.REPORT, author: opts.author, nameInMenu: 'Attendance Report', showInMenu: true, route: '/crm/reports/attendance', icon: 'list' },
        ],
      });
      crmMain = await prisma.mainMenu.create({
        data: { companyId: cid, moduleId: crmId, menuName: 'Enquiry', sortOrder: 1, objectType: ObjectType.FORM, isUserMenu: true, icon: 'list' },
      });
      for (const [i, name] of ['Enquiry AMC', 'Enquiry OT', 'Enquiry EMG COT'].entries()) {
        const sub = await prisma.subMenu.create({
          data: { mainMenuId: crmMain.id, subMenuName: name, route: `/crm/enquiry/${name.toLowerCase().replace(/\s+/g, '-')}`, icon: 'list', sortOrder: i + 1, objectType: ObjectType.FORM },
        });
        crmSubIds.push(sub.id);
      }
      for (const [i, g] of CRM_GADGETS.entries()) {
        const rec = await prisma.gadget.create({
          data: { companyId: cid, moduleId: crmId, code: g.code, name: g.name, description: g.description, sortOrder: i + 1 },
        });
        crmGadgetIds.push(rec.id);
      }
    }

    // ---- User groups ----
    const adminGroup = await prisma.userGroup.create({
      data: { companyId: cid, name: 'Administrators', description: 'Full access to enabled modules.', isSystem: true },
    });
    // Admin group manages every enabled module.
    for (const code of opts.enabledModules) {
      await prisma.userGroupModule.create({ data: { userGroupId: adminGroup.id, moduleId: modules[code] } });
    }
    // Grant full Cpanel privileges.
    await prisma.groupMainMenuAccess.create({ data: { userGroupId: adminGroup.id, mainMenuId: cpanelMain.id, visible: true } });
    for (const subId of cpanelSubIds) {
      await prisma.groupSubMenuPrivilege.create({
        data: { userGroupId: adminGroup.id, subMenuId: subId, canMenu: true, canView: true, canAdd: true, canEdit: true, canDelete: true },
      });
    }
    for (const gid of cpanelGadgetIds) {
      await prisma.groupGadget.create({ data: { userGroupId: adminGroup.id, gadgetId: gid } });
    }

    // A CRM-only group (demonstrates per-company group variation).
    let crmGroup: { id: number } | null = null;
    if (crmMain) {
      crmGroup = await prisma.userGroup.create({
        data: { companyId: cid, name: 'CRM Team', description: 'CRM users.' },
      });
      await prisma.userGroupModule.create({ data: { userGroupId: crmGroup.id, moduleId: modules['CRM'] } });
      await prisma.groupMainMenuAccess.create({ data: { userGroupId: crmGroup.id, mainMenuId: crmMain.id, visible: true } });
      for (const subId of crmSubIds) {
        await prisma.groupSubMenuPrivilege.create({
          data: { userGroupId: crmGroup.id, subMenuId: subId, canMenu: true, canView: true, canAdd: true, canEdit: false, canDelete: false },
        });
      }
      for (const gid of crmGadgetIds) {
        await prisma.groupGadget.create({ data: { userGroupId: crmGroup.id, gadgetId: gid } });
      }
    }

    // ---- Dashboards (multiple per module + group) ----
    // Register a DASHBOARD object and build a dashboard from it.
    const adminDashObj = await prisma.objectMaster.create({
      data: { companyId: cid, moduleId: cpanelId, objectName: 'db_adminoverview', objectType: ObjectType.DASHBOARD, author: opts.author, nameInMenu: 'Admin Overview', showInMenu: true, route: '/dashboard', icon: 'layout-dashboard' },
    });
    const adminDash = await prisma.dashboard.create({
      data: { companyId: cid, moduleId: cpanelId, userGroupId: adminGroup.id, objectId: adminDashObj.id, name: 'Admin Overview', icon: 'layout-dashboard', sortOrder: 1, isDefault: true },
    });
    const adminWidgetCodes = ['USERS_COUNT', 'GROUPS_COUNT', 'MODULES_COUNT', 'COMPANIES_COUNT', 'RECENT_OBJECTS', 'QUICK_LINKS'];
    for (const [i, code] of adminWidgetCodes.entries()) {
      const g = await prisma.gadget.findFirst({ where: { companyId: cid, moduleId: cpanelId, code } });
      if (g) {
        const meta = CPANEL_GADGETS.find((x) => x.code === code);
        await prisma.dashboardWidget.create({ data: { dashboardId: adminDash.id, gadgetId: g.id, sortOrder: i + 1, width: meta?.width ?? 1 } });
      }
    }
    // A second Cpanel dashboard (objects-focused) for the admin group.
    const objDash = await prisma.dashboard.create({
      data: { companyId: cid, moduleId: cpanelId, userGroupId: adminGroup.id, name: 'Objects Overview', icon: 'database', sortOrder: 2 },
    });
    for (const [i, code] of ['FORMS_COUNT', 'REPORTS_COUNT', 'TABLES_COUNT', 'RECENT_OBJECTS'].entries()) {
      const g = await prisma.gadget.findFirst({ where: { companyId: cid, moduleId: cpanelId, code } });
      if (g) {
        const meta = CPANEL_GADGETS.find((x) => x.code === code);
        await prisma.dashboardWidget.create({ data: { dashboardId: objDash.id, gadgetId: g.id, sortOrder: i + 1, width: meta?.width ?? 1 } });
      }
    }

    if (crmMain && crmGroup) {
      const crmDash = await prisma.dashboard.create({
        data: { companyId: cid, moduleId: modules['CRM'], userGroupId: crmGroup.id, name: 'Sales Overview', icon: 'list', sortOrder: 1, isDefault: true },
      });
      for (const [i, code] of ['CRM_ENQUIRIES', 'CRM_WELCOME', 'CRM_QUICK_LINKS'].entries()) {
        const g = await prisma.gadget.findFirst({ where: { companyId: cid, moduleId: modules['CRM'], code } });
        if (g) {
          const meta = CRM_GADGETS.find((x) => x.code === code);
          await prisma.dashboardWidget.create({ data: { dashboardId: crmDash.id, gadgetId: g.id, sortOrder: i + 1, width: meta?.width ?? 1 } });
        }
      }
    }

    return { company, adminGroup, crmGroup };
  }

  // -------------------------------------------------------------------------
  // Two demo companies with different module sets.
  // -------------------------------------------------------------------------
  const acme = await seedCompany({
    code: 'ACME',
    name: 'Acme Industries',
    legalName: 'Acme Industries Private Limited',
    city: 'Kochi',
    enabledModules: ['CPANEL', 'CRM', 'ACCOUNTS'],
    author: 'Pavani',
  });
  const globex = await seedCompany({
    code: 'GLOBEX',
    name: 'Globex Corporation',
    legalName: 'Globex Corporation Private Limited',
    city: 'Bengaluru',
    enabledModules: ['CPANEL', 'CRM'],
    author: 'Vismaya',
  });

  // -------------------------------------------------------------------------
  // Super admin user — access to both companies (bypasses privilege checks).
  // -------------------------------------------------------------------------
  const username = process.env.SEED_ADMIN_USERNAME || 'superadmin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: {
      userCode: 'ASP001',
      username,
      name: process.env.SEED_ADMIN_NAME || 'Super Administrator',
      email: process.env.SEED_ADMIN_EMAIL || 'admin@erpgrip.local',
      passwordHash,
      isSuperAdmin: true,
      isActive: true,
      securityType: 'PASSWORD',
      webEnabled: true,
      mobileEnabled: true, // super admin has both web + mobile access
      defaultModuleId: modules['CPANEL'],
      companies: {
        create: [
          { companyId: acme.company.id, isDefault: true },
          { companyId: globex.company.id },
        ],
      },
    },
  });
  void admin;

  // -------------------------------------------------------------------------
  // Regular user — Administrators in Acme, CRM Team in Globex. Demonstrates a
  // user whose group / rights vary by company.
  // -------------------------------------------------------------------------
  const johnHash = await bcrypt.hash('User@123', 10);
  await prisma.user.create({
    data: {
      userCode: 'USR001',
      username: 'jdoe',
      name: 'John Doe',
      email: 'jdoe@erpgrip.local',
      passwordHash: johnHash,
      isActive: true,
      securityType: 'PASSWORD',
      webEnabled: true,
      mobileEnabled: false, // John has web access only
      defaultModuleId: modules['CPANEL'],
      companies: {
        create: [
          { companyId: acme.company.id, isDefault: true },
          { companyId: globex.company.id },
        ],
      },
      groupAssignments: {
        create: [
          { userGroupId: acme.adminGroup.id },
          ...(globex.crmGroup ? [{ userGroupId: globex.crmGroup.id }] : []),
        ],
      },
      // Per-company module assignment (always a subset of the modules the
      // user's groups manage). In Acme (Administrators -> all modules) give
      // Cpanel + CRM but not Accounts. In Globex (CRM Team -> CRM only) give CRM.
      modules: {
        create: [
          { companyId: acme.company.id, moduleId: modules['CPANEL'] },
          { companyId: acme.company.id, moduleId: modules['CRM'] },
          { companyId: globex.company.id, moduleId: modules['CRM'] },
        ],
      },
    },
  });

  console.log(`Done. Super admin: ${username} / ${password}  |  Sample user: jdoe / User@123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

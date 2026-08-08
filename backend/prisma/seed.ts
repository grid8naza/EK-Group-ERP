/* eslint-disable no-console */
import { PrismaClient, ObjectType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  CPANEL_SUBS,
  provisionCompanyCpanel,
} from '../src/modules/company/company-provisioning';

const prisma = new PrismaClient();

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
    { code: 'PRODUCTION', name: 'Production', icon: 'factory', sortOrder: 6, isActive: true, description: 'Manufacturing & production orders.' },
  ];
  const modules: Record<string, number> = {};
  for (const m of moduleDefs) {
    const rec = await prisma.module.create({ data: m });
    modules[m.code] = rec.id;
  }

  // -------------------------------------------------------------------------
  // Object Master (GLOBAL) — one definition per screen, shared by every
  // company. Objects are no longer company-scoped.
  // -------------------------------------------------------------------------
  const OBJECT_AUTHOR = 'Pavani';
  for (const s of CPANEL_SUBS) {
    await prisma.objectMaster.create({
      data: {
        moduleId: modules['CPANEL'],
        author: OBJECT_AUTHOR,
        objectType: ObjectType.FORM,
        objectName: s.name,
        nameInMenu: s.name,
        showInMenu: true,
        route: s.route,
        icon: s.icon,
        isSystem: true, // Cpanel core objects: super-admin only, locked
        isLocked: true,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Security settings (global singleton) — the "high security password" gate
  // for database backup / restore. Distinct from any login password.
  // -------------------------------------------------------------------------
  const highSecurityPassword =
    process.env.SEED_HIGH_SECURITY_PASSWORD || 'Backup@123';
  await prisma.securitySetting.create({
    data: {
      id: 1,
      highSecurityPasswordHash: await bcrypt.hash(highSecurityPassword, 10),
    },
  });

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
  for (const [i, value] of ['settings', 'users', 'list', 'database', 'database-backup', 'building', 'shield', 'menu', 'wallet', 'layout-dashboard', 'factory', 'package'].entries()) {
    await prisma.lookupValue.create({ data: { lookupId: iconLookup.id, value, label: value, sortOrder: i + 1 } });
  }

  // -------------------------------------------------------------------------
  // Currency master (global) — the source for a company's currency.
  // -------------------------------------------------------------------------
  for (const c of [
    { code: 'INR', name: 'Indian Rupee', symbol: '₹', fractionalUnit: 'Paisa' },
    { code: 'USD', name: 'US Dollar', symbol: '$', fractionalUnit: 'Cent' },
    { code: 'EUR', name: 'Euro', symbol: '€', fractionalUnit: 'Cent' },
    { code: 'GBP', name: 'Pound Sterling', symbol: '£', fractionalUnit: 'Penny' },
    { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', fractionalUnit: 'Fils' },
  ]) {
    await prisma.currency.create({ data: c });
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

    // ---- Cpanel scaffold (menus, Administrators group) ----
    // Shared with the runtime "create company" endpoint so the two never drift.
    const provisioned = await provisionCompanyCpanel(prisma, cid);
    if (!provisioned) throw new Error(`Company ${cid} was already provisioned`);
    const adminGroup = provisioned.adminGroup;
    // The Administrators group also manages every enabled user module
    // (Cpanel is already linked by provisioning).
    for (const code of opts.enabledModules) {
      if (code === 'CPANEL') continue;
      await prisma.userGroupModule.create({ data: { userGroupId: adminGroup.id, moduleId: modules[code] } });
    }

    // ---- CRM (if enabled) ----
    const crmEnabled = opts.enabledModules.includes('CRM');

    // A CRM-only group (demonstrates per-company group variation).
    let crmGroup: { id: number } | null = null;
    if (crmEnabled) {
      crmGroup = await prisma.userGroup.create({
        data: { companyId: cid, name: 'CRM Team', description: 'CRM users.' },
      });
      await prisma.userGroupModule.create({ data: { userGroupId: crmGroup.id, moduleId: modules['CRM'] } });
    }

    return { company, adminGroup, crmGroup };
  }

  // -------------------------------------------------------------------------
  // The three EK Group companies, with different module sets.
  //
  // ORDER MATTERS: they are created EK001, EK002, EK003 so their ids come out
  // 1, 2, 3. Master data that ships with the application names companies by id
  // — the inventory classification tree does (see
  // modules/category/inventory-tree-data.ts), and the Chart of Accounts maps
  // MFG/RTL/TRD onto these same three codes. Seeding a different company first
  // would hand id 1 to the wrong company and scope that master data to it,
  // silently: companyId is a plain cross-domain id, so nothing would object.
  // -------------------------------------------------------------------------
  const ek001 = await seedCompany({
    code: 'EK001',
    name: 'EK Food Products',
    legalName: 'Edakkattukudiyil Regency Food Products Private Limited',
    city: 'Kochi',
    enabledModules: ['CPANEL', 'CRM', 'ACCOUNTS', 'INVENTORY', 'HR', 'PRODUCTION'],
    author: 'Pavani',
  });
  const ek002 = await seedCompany({
    code: 'EK002',
    name: 'EK Bake House',
    legalName: 'Edakkattukudiyil Regency Bake House Private Limited',
    city: 'Muvattupuzha',
    enabledModules: ['CPANEL', 'CRM', 'ACCOUNTS', 'INVENTORY', 'HR', 'PRODUCTION'],
    author: 'Vismaya',
  });
  // The trading company: it buys and resells rather than manufacturing, which
  // is why Production is off here and why the Chart of Accounts gives TRD no
  // raw-material or work-in-progress inventory accounts.
  const ek003 = await seedCompany({
    code: 'EK003',
    name: 'Regency Bakers',
    legalName: 'Regency Bakers & Confectionaries',
    city: 'Kochi',
    enabledModules: ['CPANEL', 'CRM', 'ACCOUNTS', 'INVENTORY', 'HR'],
    author: 'Pavani',
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
          { companyId: ek001.company.id, isDefault: true },
          { companyId: ek002.company.id },
          { companyId: ek003.company.id },
        ],
      },
    },
  });
  void admin;

  // -------------------------------------------------------------------------
  // Regular user — Administrators in EK001, CRM Team in EK002. Demonstrates a
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
          // Per-company default module: Cpanel in EK001, CRM in EK002.
          {
            companyId: ek001.company.id,
            isDefault: true,
            defaultModuleId: modules['CPANEL'],
          },
          { companyId: ek002.company.id, defaultModuleId: modules['CRM'] },
        ],
      },
      groupAssignments: {
        create: [
          { userGroupId: ek001.adminGroup.id },
          ...(ek002.crmGroup ? [{ userGroupId: ek002.crmGroup.id }] : []),
        ],
      },
      // Per-company module assignment (always a subset of the modules the
      // user's groups manage). In EK001 (Administrators -> all modules) give
      // Cpanel + CRM but not Accounts. In EK002 (CRM Team -> CRM only) give CRM.
      modules: {
        create: [
          { companyId: ek001.company.id, moduleId: modules['CPANEL'] },
          { companyId: ek001.company.id, moduleId: modules['CRM'] },
          { companyId: ek002.company.id, moduleId: modules['CRM'] },
        ],
      },
    },
  });

  console.log(`Done. Super admin: ${username} / ${password}  |  Sample user: jdoe / User@123`);
  console.log(`High security password (backup/restore): ${highSecurityPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

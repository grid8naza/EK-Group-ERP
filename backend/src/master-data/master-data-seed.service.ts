import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UNITS, HSN_CODES } from './units.data';
import { INVENTORY_CATEGORIES, INVENTORY_GROUPS } from './inventory-tree.data';
import {
  HR_CATEGORIES,
  HR_GROUPS,
  HR_DESIGNATIONS,
  HR_EMPLOYEES,
} from './hr.data';
import { ASSET_CATEGORIES, ASSET_GROUPS, ASSETS } from './assets.data';
import {
  BRANCHES,
  STORES,
  COST_CENTERS,
  COST_OBJECTS,
} from './operations.data';
import { ITEMS } from './items.data';
import { PRODUCTS } from './products.data';
import { RECIPES } from './recipes.data';
import { CUSTOMERS, SUPPLIERS, SeedParty } from './parties.data';

/**
 * Loads the master data the business was set up with, so a new database comes
 * up ready to work instead of empty.
 *
 * ONE service rather than one per module, because the order is the whole
 * problem: an item needs its unit, group and HSN; a product needs its item; a
 * process step needs its machine and its designation; a pack needs the bulk it
 * is packed from. Nest gives no ordering guarantee across providers, so a
 * seeder per module would come up in whatever order the modules happened to
 * register and quietly skip half its rows. Here the sequence is written down.
 *
 * Additive and idempotent throughout, the same rule as the Chart of Accounts
 * seed: keyed on CODE, it creates what is missing and never writes over a row
 * that exists. A rate someone has revised on the Asset screen, a price revised
 * on Price Review, a recipe someone has tuned — all survive a redeploy.
 *
 * That rule has one consequence worth stating: a product that exists but whose
 * recipe was deleted will NOT have it restored, because the product is the key
 * and the product is there. Recipes are seeded only onto products this run
 * created, plus any product carrying no lines at all.
 */
@Injectable()
export class MasterDataSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MasterDataSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const n = {
        units: await this.seedUnits(),
        hsn: await this.seedHsn(),
        invCategories: 0,
        invGroups: 0,
        hr: 0,
        assets: 0,
        operations: 0,
        employees: 0,
        items: 0,
        products: 0,
        recipes: 0,
        parties: 0,
      };
      const tree = await this.seedInventoryTree();
      n.invCategories = tree.categories;
      n.invGroups = tree.groups;
      n.hr = await this.seedHr();
      n.assets = await this.seedAssets();
      n.operations = await this.seedOperations();
      // AFTER operations, not with the rest of HR: an employee names the
      // division and department they sit in, and those are cost centres and
      // cost objects that seedOperations has only just created. Run with the HR
      // tree and every seeded employee would come up with no posting at all.
      n.employees = await this.seedEmployees();
      n.items = await this.seedItems();
      n.products = await this.seedProducts();
      n.recipes = await this.seedRecipes();
      n.parties = await this.seedParties();

      const total = Object.values(n).reduce((a, b) => a + b, 0);
      if (total) {
        this.logger.log(
          `Master data seeded: +${n.units} units, +${n.hsn} HSN codes, ` +
            `+${n.invCategories} categories, +${n.invGroups} groups, +${n.hr} HR rows, ` +
            `+${n.assets} asset rows, +${n.operations} stores/cost rows, ` +
            `+${n.employees} employees, ` +
            `+${n.items} items, +${n.products} products, +${n.recipes} recipes, ` +
            `+${n.parties} customers/suppliers.`,
        );
      }
    } catch (e) {
      // The masters are what every screen reads, but a failure here must not
      // stop the app booting — it is logged and retried next start.
      this.logger.error(
        `Master data seed failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Codes already present, so "create what is missing" is one lookup. */
  private async have(rows: Promise<{ code: string }[]>): Promise<Set<string>> {
    return new Set((await rows).map((r) => r.code));
  }

  /** Company ids this database actually holds — companyId carries no FK, so
   *  nothing else would catch one that is not there. */
  private async companies(): Promise<Set<number>> {
    return new Set(
      (await this.prisma.company.findMany({ select: { id: true } })).map(
        (c) => c.id,
      ),
    );
  }

  private warnMissingCompanies(where: string, missing: Set<number>): void {
    if (!missing.size) return;
    this.logger.warn(
      `${where}: skipped company links for ids ` +
        `${[...missing].sort((a, b) => a - b).join(', ')} — no such company here.`,
    );
  }

  // ---- units and HSN -------------------------------------------------------

  /**
   * Base units before the units that convert to them — a derived unit names
   * its base by code and needs that row's id.
   */
  private async seedUnits(): Promise<number> {
    const id = new Map(
      (
        await this.prisma.unit.findMany({ select: { id: true, code: true } })
      ).map((u) => [u.code, u.id]),
    );
    let made = 0;
    for (const pass of [
      UNITS.filter((u) => !u.baseUnitCode),
      UNITS.filter((u) => u.baseUnitCode),
    ]) {
      for (const u of pass) {
        if (id.has(u.code)) continue;
        const row = await this.prisma.unit.create({
          data: {
            code: u.code,
            name: u.name,
            symbol: u.symbol,
            type: u.type as never,
            baseUnitId: u.baseUnitCode
              ? (id.get(u.baseUnitCode) ?? null)
              : null,
            conversionFactor: u.conversionFactor,
            decimalPlaces: u.decimalPlaces,
            isActive: u.isActive,
          },
          select: { id: true },
        });
        id.set(u.code, row.id);
        made++;
      }
    }
    return made;
  }

  private async seedHsn(): Promise<number> {
    const have = await this.have(
      this.prisma.hsnCode.findMany({ select: { code: true } }),
    );
    const rows = HSN_CODES.filter((h) => !have.has(h.code));
    if (!rows.length) return 0;
    const res = await this.prisma.hsnCode.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return res.count;
  }

  // ---- inventory classification tree --------------------------------------

  private async seedInventoryTree(): Promise<{
    categories: number;
    groups: number;
  }> {
    const companies = await this.companies();
    const missing = new Set<number>();

    const haveCat = await this.have(
      this.prisma.category.findMany({ select: { code: true } }),
    );
    const newCats = INVENTORY_CATEGORIES.filter((c) => !haveCat.has(c.code));
    if (newCats.length) {
      await this.prisma.category.createMany({
        data: newCats.map((c) => ({
          code: c.code,
          name: c.name,
          kind: c.kind,
          allCompanies: c.allCompanies,
        })),
        skipDuplicates: true,
      });
    }

    // Parents before children: a sub-group needs its parent's id.
    const groupId = new Map(
      (
        await this.prisma.group.findMany({ select: { id: true, code: true } })
      ).map((g) => [g.code, g.id]),
    );
    let groups = 0;
    for (const level of [...new Set(INVENTORY_GROUPS.map((g) => g.level))].sort(
      (a, b) => a - b,
    )) {
      for (const g of INVENTORY_GROUPS.filter((x) => x.level === level)) {
        if (groupId.has(g.code)) continue;
        const parentGroupId = g.parentCode
          ? (groupId.get(g.parentCode) ?? null)
          : null;
        if (g.parentCode && parentGroupId == null) {
          this.logger.warn(
            `Group ${g.code} skipped: parent ${g.parentCode} missing.`,
          );
          continue;
        }
        const row = await this.prisma.group.create({
          data: {
            code: g.code,
            name: g.name,
            level: g.level,
            parentGroupId,
            subGroupApplicable: g.subGroupApplicable,
            allCompanies: g.allCompanies,
          },
          select: { id: true },
        });
        groupId.set(g.code, row.id);
        groups++;
      }
    }

    // Links for everything, including rows that were already here: a boot that
    // died between the rows and their links would otherwise never recover.
    const catId = new Map(
      (
        await this.prisma.category.findMany({
          select: { id: true, code: true },
        })
      ).map((c) => [c.code, c.id]),
    );
    const haveGC = new Set(
      (
        await this.prisma.groupCategory.findMany({
          select: { groupId: true, categoryId: true },
        })
      ).map((r) => `${r.groupId}:${r.categoryId}`),
    );
    const gc: { groupId: number; categoryId: number }[] = [];
    for (const g of INVENTORY_GROUPS) {
      const gid = groupId.get(g.code);
      if (gid == null) continue;
      for (const code of g.categories) {
        const cid = catId.get(code);
        if (cid == null || haveGC.has(`${gid}:${cid}`)) continue;
        gc.push({ groupId: gid, categoryId: cid });
      }
    }
    if (gc.length)
      await this.prisma.groupCategory.createMany({
        data: gc,
        skipDuplicates: true,
      });

    const haveCC = new Set(
      (
        await this.prisma.categoryCompany.findMany({
          select: { categoryId: true, companyId: true },
        })
      ).map((r) => `${r.categoryId}:${r.companyId}`),
    );
    const cc: { categoryId: number; companyId: number }[] = [];
    for (const c of INVENTORY_CATEGORIES) {
      const cid = catId.get(c.code);
      if (cid == null) continue;
      for (const companyId of c.companies) {
        if (!companies.has(companyId)) {
          missing.add(companyId);
          continue;
        }
        if (haveCC.has(`${cid}:${companyId}`)) continue;
        cc.push({ categoryId: cid, companyId });
      }
    }
    if (cc.length)
      await this.prisma.categoryCompany.createMany({
        data: cc,
        skipDuplicates: true,
      });

    const haveGCo = new Set(
      (
        await this.prisma.groupCompany.findMany({
          select: { groupId: true, companyId: true },
        })
      ).map((r) => `${r.groupId}:${r.companyId}`),
    );
    const gco: { groupId: number; companyId: number }[] = [];
    for (const g of INVENTORY_GROUPS) {
      const gid = groupId.get(g.code);
      if (gid == null) continue;
      for (const companyId of g.companies) {
        if (!companies.has(companyId)) {
          missing.add(companyId);
          continue;
        }
        if (haveGCo.has(`${gid}:${companyId}`)) continue;
        gco.push({ groupId: gid, companyId });
      }
    }
    if (gco.length)
      await this.prisma.groupCompany.createMany({
        data: gco,
        skipDuplicates: true,
      });

    this.warnMissingCompanies('Inventory tree', missing);
    return { categories: newCats.length, groups };
  }

  // ---- HR ------------------------------------------------------------------

  private async seedHr(): Promise<number> {
    const companies = await this.companies();
    const missing = new Set<number>();
    let made = 0;

    const haveCat = await this.have(
      this.prisma.hrCategory.findMany({ select: { code: true } }),
    );
    for (const c of HR_CATEGORIES) {
      if (haveCat.has(c.code)) continue;
      await this.prisma.hrCategory.create({
        data: { code: c.code, name: c.name, allCompanies: c.allCompanies },
      });
      made++;
    }
    const catId = new Map(
      (
        await this.prisma.hrCategory.findMany({
          select: { id: true, code: true },
        })
      ).map((c) => [c.code, c.id]),
    );

    const groupId = new Map(
      (
        await this.prisma.hrGroup.findMany({ select: { id: true, code: true } })
      ).map((g) => [g.code, g.id]),
    );
    for (const level of [...new Set(HR_GROUPS.map((g) => g.level))].sort(
      (a, b) => a - b,
    )) {
      for (const g of HR_GROUPS.filter((x) => x.level === level)) {
        if (groupId.has(g.code)) continue;
        const categoryId = catId.get(g.categoryCode);
        if (categoryId == null) continue;
        const row = await this.prisma.hrGroup.create({
          data: {
            code: g.code,
            name: g.name,
            categoryId,
            level: g.level,
            parentGroupId: g.parentCode
              ? (groupId.get(g.parentCode) ?? null)
              : null,
            subGroupApplicable: g.subGroupApplicable,
            allCompanies: g.allCompanies,
          },
          select: { id: true },
        });
        groupId.set(g.code, row.id);
        made++;
      }
    }

    const haveDes = await this.have(
      this.prisma.hrDesignation.findMany({ select: { code: true } }),
    );
    for (const d of HR_DESIGNATIONS) {
      if (haveDes.has(d.code)) continue;
      const categoryId = catId.get(d.categoryCode);
      const gid = groupId.get(d.groupCode);
      if (categoryId == null || gid == null) continue;
      const row = await this.prisma.hrDesignation.create({
        data: {
          code: d.code,
          name: d.name,
          categoryId,
          groupId: gid,
          ratePerHour: d.ratePerHour,
          allCompanies: d.allCompanies,
        },
        select: { id: true },
      });
      made++;
      for (const companyId of d.companies) {
        if (!companies.has(companyId)) {
          missing.add(companyId);
          continue;
        }
        await this.prisma.hrDesignationCompany
          .create({
            data: { designationId: row.id, companyId },
          })
          .catch(() => undefined);
      }
    }

    this.warnMissingCompanies('HR master', missing);
    return made;
  }

  /**
   * The employees on that tree.
   *
   * Keyed on (companyId, code), which is what the Employee table itself is
   * unique on — a code is only ever unique WITHIN a company, so a bare code
   * would collide the day a second company starts its own series.
   *
   * Everything a seeded employee points at is named by CODE and resolved here:
   * an id means nothing in another database, and the divisions, departments and
   * branches these reference are themselves seeded per company. A row whose
   * designation is missing is SKIPPED rather than half-created — designationId
   * is required, and an employee with no job is not a record worth having.
   *
   * `reportsTo` is resolved in a second pass, after every row exists. Ordering
   * the data so a manager precedes their reports is not enough on its own: an
   * existing database may already hold the manager and not the report, or the
   * other way round.
   */
  private async seedEmployees(): Promise<number> {
    if (!HR_EMPLOYEES.length) return 0;
    const companies = await this.companies();
    const missing = new Set<number>();
    let made = 0;

    const existing = new Set(
      (
        await this.prisma.employee.findMany({
          select: { companyId: true, code: true },
        })
      ).map((e) => `${e.companyId}|${e.code}`),
    );

    const designationId = new Map(
      (
        await this.prisma.hrDesignation.findMany({
          select: { id: true, code: true },
        })
      ).map((d) => [d.code, d.id]),
    );
    // Branch, division and department codes repeat across companies, so each is
    // keyed by company as well — the same "SD" is a different division in each.
    const branchId = new Map(
      (
        await this.prisma.branch.findMany({
          select: { id: true, code: true, companyId: true },
        })
      ).map((b) => [`${b.companyId}|${b.code}`, b.id]),
    );
    const centreId = new Map(
      (
        await this.prisma.costCenter.findMany({
          select: { id: true, code: true, companyId: true },
        })
      ).map((c) => [`${c.companyId}|${c.code}`, c.id]),
    );
    const objectId = new Map(
      (
        await this.prisma.costObject.findMany({
          select: { id: true, code: true, companyId: true },
        })
      ).map((o) => [`${o.companyId}|${o.code}`, o.id]),
    );

    for (const e of HR_EMPLOYEES) {
      if (existing.has(`${e.companyId}|${e.code}`)) continue;
      if (!companies.has(e.companyId)) {
        missing.add(e.companyId);
        continue;
      }
      const designation = designationId.get(e.designationCode);
      if (designation == null) {
        this.logger.warn(
          `HR master: skipped employee ${e.code} — no designation ${e.designationCode} here.`,
        );
        continue;
      }
      await this.prisma.employee.create({
        data: {
          code: e.code,
          name: e.name,
          companyId: e.companyId,
          branchId: e.branchCode
            ? (branchId.get(`${e.companyId}|${e.branchCode}`) ?? null)
            : null,
          designationId: designation,
          dateOfJoin: new Date(`${e.dateOfJoin}T00:00:00.000Z`),
          costCenterId: e.costCenterCode
            ? (centreId.get(`${e.companyId}|${e.costCenterCode}`) ?? null)
            : null,
          costObjectId: e.costObjectCode
            ? (objectId.get(`${e.companyId}|${e.costObjectCode}`) ?? null)
            : null,
          isActive: e.isActive,
        },
      });
      made++;
    }

    // Second pass: who answers to whom, now that both ends exist.
    const byKey = new Map(
      (
        await this.prisma.employee.findMany({
          select: { id: true, code: true, companyId: true, reportsToId: true },
        })
      ).map((e) => [`${e.companyId}|${e.code}`, e]),
    );
    for (const e of HR_EMPLOYEES) {
      if (!e.reportsToCode) continue;
      const row = byKey.get(`${e.companyId}|${e.code}`);
      const manager = byKey.get(`${e.companyId}|${e.reportsToCode}`);
      // Never overwrite a reporting line somebody has already set by hand.
      if (!row || !manager || row.reportsToId != null) continue;
      await this.prisma.employee.update({
        where: { id: row.id },
        data: { reportsToId: manager.id },
      });
    }

    this.warnMissingCompanies('Employees', missing);
    return made;
  }

  // ---- assets --------------------------------------------------------------

  private async seedAssets(): Promise<number> {
    const companies = await this.companies();
    const missing = new Set<number>();
    let made = 0;

    const haveCat = await this.have(
      this.prisma.assetCategory.findMany({ select: { code: true } }),
    );
    for (const c of ASSET_CATEGORIES) {
      if (haveCat.has(c.code)) continue;
      await this.prisma.assetCategory.create({
        data: { code: c.code, name: c.name, allCompanies: c.allCompanies },
      });
      made++;
    }
    const catId = new Map(
      (
        await this.prisma.assetCategory.findMany({
          select: { id: true, code: true },
        })
      ).map((c) => [c.code, c.id]),
    );

    const groupId = new Map(
      (
        await this.prisma.assetGroup.findMany({
          select: { id: true, code: true },
        })
      ).map((g) => [g.code, g.id]),
    );
    for (const level of [...new Set(ASSET_GROUPS.map((g) => g.level))].sort(
      (a, b) => a - b,
    )) {
      for (const g of ASSET_GROUPS.filter((x) => x.level === level)) {
        if (groupId.has(g.code)) continue;
        const categoryId = catId.get(g.categoryCode);
        if (categoryId == null) continue;
        const row = await this.prisma.assetGroup.create({
          data: {
            code: g.code,
            name: g.name,
            categoryId,
            level: g.level,
            parentGroupId: g.parentCode
              ? (groupId.get(g.parentCode) ?? null)
              : null,
            subGroupApplicable: g.subGroupApplicable,
            allCompanies: g.allCompanies,
          },
          select: { id: true },
        });
        groupId.set(g.code, row.id);
        made++;
      }
    }

    const unitId = await this.unitIds();
    const haveAsset = await this.have(
      this.prisma.asset.findMany({ select: { code: true } }),
    );
    for (const a of ASSETS) {
      if (haveAsset.has(a.code)) continue;
      const categoryId = catId.get(a.categoryCode);
      const gid = groupId.get(a.groupCode);
      if (categoryId == null || gid == null) continue;
      const row = await this.prisma.asset.create({
        data: {
          code: a.code,
          name: a.name,
          categoryId,
          groupId: gid,
          brand: a.brand,
          model: a.model,
          minCapacity: a.minCapacity,
          maxCapacity: a.maxCapacity,
          capacityUnitId: a.capacityUnitCode
            ? (unitId.get(a.capacityUnitCode) ?? null)
            : null,
          perUnitId: a.perUnitCode ? (unitId.get(a.perUnitCode) ?? null) : null,
          isProductionLine: a.isProductionLine,
          costPerHour: a.costPerHour,
          lifeSpanYears: a.lifeSpanYears,
          status: a.status as never,
          allCompanies: a.allCompanies,
        },
        select: { id: true },
      });
      made++;
      for (const companyId of a.companies) {
        if (!companies.has(companyId)) {
          missing.add(companyId);
          continue;
        }
        await this.prisma.assetCompany
          .create({ data: { assetId: row.id, companyId } })
          .catch(() => undefined);
      }
    }

    this.warnMissingCompanies('Asset master', missing);
    return made;
  }

  // ---- stores and cost analysis -------------------------------------------

  private async seedOperations(): Promise<number> {
    const companies = await this.companies();
    const missing = new Set<number>();
    let made = 0;

    // Branches first: a store sits in one, and so does an employee.
    const haveBranch = new Set(
      (
        await this.prisma.branch.findMany({
          select: { companyId: true, code: true },
        })
      ).map((b) => `${b.companyId}:${b.code}`),
    );
    for (const b of BRANCHES) {
      if (!companies.has(b.companyId)) {
        missing.add(b.companyId);
        continue;
      }
      if (haveBranch.has(`${b.companyId}:${b.code}`)) continue;
      await this.prisma.branch.create({
        data: {
          companyId: b.companyId,
          code: b.code,
          name: b.name,
          isActive: b.isActive,
        },
      });
      made++;
    }

    const haveStore = new Set(
      (
        await this.prisma.store.findMany({
          select: { companyId: true, code: true },
        })
      ).map((s) => `${s.companyId}:${s.code}`),
    );
    for (const s of STORES) {
      if (!companies.has(s.companyId)) {
        missing.add(s.companyId);
        continue;
      }
      if (haveStore.has(`${s.companyId}:${s.code}`)) continue;
      await this.prisma.store.create({
        data: {
          companyId: s.companyId,
          code: s.code,
          name: s.name,
          isActive: s.isActive,
        },
      });
      made++;
    }

    const haveCentre = new Set(
      (
        await this.prisma.costCenter.findMany({
          select: { companyId: true, code: true },
        })
      ).map((c) => `${c.companyId}:${c.code}`),
    );
    for (const c of COST_CENTERS) {
      if (!companies.has(c.companyId)) {
        missing.add(c.companyId);
        continue;
      }
      if (haveCentre.has(`${c.companyId}:${c.code}`)) continue;
      await this.prisma.costCenter.create({
        data: {
          companyId: c.companyId,
          code: c.code,
          name: c.name,
          isActive: c.isActive,
        },
      });
      made++;
    }

    const centreId = new Map(
      (
        await this.prisma.costCenter.findMany({
          select: { id: true, companyId: true, code: true },
        })
      ).map((c) => [`${c.companyId}:${c.code}`, c.id]),
    );
    const haveObject = new Set(
      (
        await this.prisma.costObject.findMany({
          select: { companyId: true, code: true },
        })
      ).map((o) => `${o.companyId}:${o.code}`),
    );
    for (const o of COST_OBJECTS) {
      if (!companies.has(o.companyId)) {
        missing.add(o.companyId);
        continue;
      }
      if (haveObject.has(`${o.companyId}:${o.code}`)) continue;
      const costCenterId = centreId.get(`${o.companyId}:${o.costCenterCode}`);
      if (costCenterId == null) continue;
      await this.prisma.costObject.create({
        data: {
          companyId: o.companyId,
          code: o.code,
          name: o.name,
          costCenterId,
          // What KIND of department this is. Seeded rather than left null: it is
          // what groups cost per meal, contribution per counter and running cost
          // per vehicle, so a department without one silently drops out of that
          // reporting.
          categoryCode: o.categoryCode,
          isActive: o.isActive,
        },
      });
      made++;
    }

    this.warnMissingCompanies('Stores / cost analysis', missing);
    return made;
  }

  // ---- items ---------------------------------------------------------------

  private async unitIds(): Promise<Map<string, number>> {
    return new Map(
      (
        await this.prisma.unit.findMany({ select: { id: true, code: true } })
      ).map((u) => [u.code, u.id]),
    );
  }

  private async seedItems(): Promise<number> {
    const companies = await this.companies();
    const missing = new Set<number>();
    const unitId = await this.unitIds();
    const catId = new Map(
      (
        await this.prisma.category.findMany({
          select: { id: true, code: true },
        })
      ).map((c) => [c.code, c.id]),
    );
    const groupId = new Map(
      (
        await this.prisma.group.findMany({ select: { id: true, code: true } })
      ).map((g) => [g.code, g.id]),
    );
    const hsnId = new Map(
      (
        await this.prisma.hsnCode.findMany({ select: { id: true, code: true } })
      ).map((h) => [h.code, h.id]),
    );
    const have = await this.have(
      this.prisma.item.findMany({ select: { code: true } }),
    );

    let made = 0;
    for (const i of ITEMS) {
      if (have.has(i.code)) continue;
      const categoryId = catId.get(i.categoryCode);
      const gid = groupId.get(i.groupCode);
      const uid = unitId.get(i.unitCode);
      if (categoryId == null || gid == null || uid == null) {
        this.logger.warn(
          `Item ${i.code} (${i.name}) skipped: category, group or unit missing.`,
        );
        continue;
      }
      const row = await this.prisma.item.create({
        data: {
          code: i.code,
          name: i.name,
          categoryId,
          groupId: gid,
          unitId: uid,
          lastPurchasePrice: i.lastPurchasePrice,
          hsnCodeId: i.hsnCode ? (hsnId.get(i.hsnCode) ?? null) : null,
          shelfLife: i.shelfLife,
          allCompanies: i.allCompanies,
        },
        select: { id: true },
      });
      made++;
      for (const companyId of i.companies) {
        if (!companies.has(companyId)) {
          missing.add(companyId);
          continue;
        }
        await this.prisma.itemCompany
          .create({ data: { itemId: row.id, companyId } })
          .catch(() => undefined);
      }
    }

    this.warnMissingCompanies('Item master', missing);
    return made;
  }

  // ---- products ------------------------------------------------------------

  private async seedProducts(): Promise<number> {
    const companies = await this.companies();
    const missing = new Set<number>();
    const unitId = await this.unitIds();
    const catId = new Map(
      (
        await this.prisma.category.findMany({
          select: { id: true, code: true },
        })
      ).map((c) => [c.code, c.id]),
    );
    const groupId = new Map(
      (
        await this.prisma.group.findMany({ select: { id: true, code: true } })
      ).map((g) => [g.code, g.id]),
    );
    const hsnId = new Map(
      (
        await this.prisma.hsnCode.findMany({ select: { id: true, code: true } })
      ).map((h) => [h.code, h.id]),
    );
    const have = await this.have(
      this.prisma.product.findMany({ select: { code: true } }),
    );

    let made = 0;
    for (const p of PRODUCTS) {
      if (have.has(p.code)) continue;
      const categoryId = catId.get(p.categoryCode);
      const gid = groupId.get(p.groupCode);
      const uid = unitId.get(p.unitCode);
      if (categoryId == null || gid == null || uid == null) {
        this.logger.warn(
          `Product ${p.code} (${p.name}) skipped: category, group or unit missing.`,
        );
        continue;
      }
      const row = await this.prisma.product.create({
        data: {
          code: p.code,
          name: p.name,
          categoryId,
          groupId: gid,
          unitId: uid,
          unpacked: p.unpacked,
          packed: p.packed,
          canSell: p.canSell,
          source: p.source as never,
          hasRecipe: p.hasRecipe,
          hasPacking: p.hasPacking,
          isIngredient: p.isIngredient,
          costPrice: p.costPrice,
          intercompanyPrice: p.intercompanyPrice,
          wholesalePrice: p.wholesalePrice,
          retailPrice: p.retailPrice,
          intercompanyTargetPct: p.intercompanyTargetPct,
          wholesaleTargetPct: p.wholesaleTargetPct,
          retailTargetPct: p.retailTargetPct,
          maxVariancePct: p.maxVariancePct,
          mrp: p.mrp,
          boxQty: p.boxQty,
          boxUnitId: p.boxUnitCode ? (unitId.get(p.boxUnitCode) ?? null) : null,
          hsnCodeId: p.hsnCode ? (hsnId.get(p.hsnCode) ?? null) : null,
          shelfLife: p.shelfLife,
          yieldQty: p.yieldQty,
          yieldUnitId: p.yieldUnitCode
            ? (unitId.get(p.yieldUnitCode) ?? null)
            : null,
          imageUrl: p.imageUrl,
          prodSun: p.prodSun,
          prodMon: p.prodMon,
          prodTue: p.prodTue,
          prodWed: p.prodWed,
          prodThu: p.prodThu,
          prodFri: p.prodFri,
          prodSat: p.prodSat,
          prodOccasional: p.prodOccasional,
        },
        select: { id: true },
      });
      made++;
      for (const c of p.companies) {
        if (!companies.has(c.companyId)) {
          missing.add(c.companyId);
          continue;
        }
        await this.prisma.productCompany
          .create({
            data: {
              productId: row.id,
              companyId: c.companyId,
              canProduce: c.canProduce,
              canSell: c.canSell,
            },
          })
          .catch(() => undefined);
      }
    }

    // Pack sources LAST, once every product exists — a pack points at a bulk
    // that may sit later in the list than it does.
    const prodId = new Map(
      (
        await this.prisma.product.findMany({ select: { id: true, code: true } })
      ).map((p) => [p.code, p.id]),
    );
    const havePack = new Set(
      (
        await this.prisma.productPackSource.findMany({
          select: { productId: true, sourceProductId: true },
        })
      ).map((s) => `${s.productId}:${s.sourceProductId}`),
    );
    for (const p of PRODUCTS) {
      const pid = prodId.get(p.code);
      if (pid == null) continue;
      for (const [i, s] of p.packSources.entries()) {
        const sid = prodId.get(s.sourceProductCode);
        if (sid == null || havePack.has(`${pid}:${sid}`)) continue;
        await this.prisma.productPackSource.create({
          data: {
            productId: pid,
            sourceProductId: sid,
            quantity: s.quantity,
            sequence: i,
          },
        });
      }
    }

    this.warnMissingCompanies('Product master', missing);
    return made;
  }

  // ---- recipes: BOM lines, process flow, manpower ---------------------------

  /**
   * Seeded only onto a product that carries NOTHING — no BOM line and no
   * process step. A product with either is one somebody is working on, and
   * half-restoring it would be worse than leaving it: the seed would add lines
   * beside the ones already there and double the recipe.
   */
  private async seedRecipes(): Promise<number> {
    const products = await this.prisma.product.findMany({
      select: {
        id: true,
        code: true,
        _count: { select: { bomLines: true, processes: true } },
      },
    });
    const blank = new Map(
      products
        .filter((p) => !p._count.bomLines && !p._count.processes)
        .map((p) => [p.code, p.id]),
    );
    if (!blank.size) return 0;

    const unitId = await this.unitIds();
    const itemId = new Map(
      (
        await this.prisma.item.findMany({ select: { id: true, code: true } })
      ).map((i) => [i.code, i.id]),
    );
    const machineId = new Map(
      (
        await this.prisma.asset.findMany({ select: { id: true, code: true } })
      ).map((a) => [a.code, a.id]),
    );
    const desigId = new Map(
      (
        await this.prisma.hrDesignation.findMany({
          select: { id: true, code: true },
        })
      ).map((d) => [d.code, d.id]),
    );

    let made = 0;
    for (const r of RECIPES) {
      const productId = blank.get(r.productCode);
      if (productId == null) continue;

      const lines = r.bom.flatMap((l, i) => {
        const iid = itemId.get(l.itemCode);
        const uid = unitId.get(l.unitCode);
        if (iid == null || uid == null) return [];
        return [
          {
            productId,
            kind: l.kind as never,
            sequence: i,
            itemId: iid,
            quantity: l.quantity,
            unitId: uid,
          },
        ];
      });
      if (lines.length !== r.bom.length) {
        this.logger.warn(
          `Recipe for ${r.productCode}: ${r.bom.length - lines.length} line(s) dropped — item or unit missing.`,
        );
      }
      if (lines.length)
        await this.prisma.productBomLine.createMany({ data: lines });

      for (const [i, s] of r.processes.entries()) {
        const step = await this.prisma.productProcess.create({
          data: {
            productId,
            sequence: i,
            name: s.name,
            description: s.description,
            timeValue: s.timeValue,
            timeUnit: s.timeUnit as never,
            machineId: s.machineCode
              ? (machineId.get(s.machineCode) ?? null)
              : null,
          },
          select: { id: true },
        });
        const crew = s.manpower.flatMap((m) => {
          const did = desigId.get(m.designationCode);
          return did == null
            ? []
            : [
                {
                  processId: step.id,
                  designationId: did,
                  workerCount: m.workerCount,
                },
              ];
        });
        if (crew.length)
          await this.prisma.productProcessManpower.createMany({ data: crew });
      }
      made++;
    }
    return made;
  }

  // ---- customers and suppliers ---------------------------------------------

  /**
   * LAST, because a party hangs under a control account and those come from the
   * Chart of Accounts seed, which is its own bootstrap hook in the accounts
   * module. Nest runs hooks in module-registration order, so on a fresh
   * database the chart is normally there by now — but "normally" is not a
   * guarantee, so a missing ledger is reported and the party left for the next
   * boot rather than pointed at whatever account happens to be around.
   *
   * The account must also be ADOPTED by the party's company: an unadopted
   * ledger is one that company does not keep books in, and the Customer screen
   * would reject the row on the first edit.
   */
  private async seedParties(): Promise<number> {
    if (!CUSTOMERS.length && !SUPPLIERS.length) return 0;

    const companies = await this.companies();
    const accounts = new Map(
      (
        await this.prisma.account.findMany({ select: { id: true, code: true } })
      ).map((a) => [a.code, a.id]),
    );
    if (!accounts.size) {
      this.logger.warn(
        'Customers and suppliers skipped: the Chart of Accounts is not seeded yet. ' +
          'They will be created on the next boot.',
      );
      return 0;
    }
    const adopted = new Set(
      (
        await this.prisma.accountCompany.findMany({
          select: { accountId: true, companyId: true },
        })
      ).map((r) => `${r.accountId}:${r.companyId}`),
    );

    const missingCompanies = new Set<number>();
    const missingLedgers = new Set<string>();
    let made = 0;

    const seed = async (
      rows: SeedParty[],
      have: Set<string>,
      create: (data: Record<string, unknown>) => Promise<unknown>,
    ) => {
      for (const r of rows) {
        if (have.has(`${r.companyId}:${r.code}`)) continue;
        if (!companies.has(r.companyId)) {
          missingCompanies.add(r.companyId);
          continue;
        }
        const controlAccountId = accounts.get(r.controlAccountCode);
        if (
          controlAccountId == null ||
          !adopted.has(`${controlAccountId}:${r.companyId}`)
        ) {
          missingLedgers.add(
            `${r.controlAccountCode} in company ${r.companyId}`,
          );
          continue;
        }
        await create({
          companyId: r.companyId,
          code: r.code,
          name: r.name,
          controlAccountId,
          contactPerson: r.contactPerson,
          phone: r.phone,
          email: r.email,
          gstNumber: r.gstNumber,
          address: r.address,
          creditDays: r.creditDays,
          creditLimit: r.creditLimit,
          isActive: r.isActive,
        });
        made++;
      }
    };

    const haveCus = new Set(
      (
        await this.prisma.customer.findMany({
          select: { companyId: true, code: true },
        })
      ).map((c) => `${c.companyId}:${c.code}`),
    );
    await seed(CUSTOMERS, haveCus, (data) =>
      this.prisma.customer.create({ data: data as never }),
    );

    const haveSup = new Set(
      (
        await this.prisma.supplier.findMany({
          select: { companyId: true, code: true },
        })
      ).map((s) => `${s.companyId}:${s.code}`),
    );
    await seed(SUPPLIERS, haveSup, (data) =>
      this.prisma.supplier.create({ data: data as never }),
    );

    this.warnMissingCompanies('Customers / suppliers', missingCompanies);
    if (missingLedgers.size) {
      this.logger.warn(
        `Customers / suppliers skipped — control ledger not adopted: ${[...missingLedgers].sort().join(', ')}.`,
      );
    }
    return made;
  }
}

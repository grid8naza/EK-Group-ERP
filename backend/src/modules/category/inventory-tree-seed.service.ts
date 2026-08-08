import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  INVENTORY_CATEGORIES,
  INVENTORY_GROUPS,
} from './inventory-tree-data';

/**
 * Loads the inventory classification tree on boot, so every database carries
 * the same categories and groups without anyone retyping them.
 *
 * Idempotent and ADDITIVE, in the same spirit as the Chart of Accounts seed and
 * the module/menu scaffold: a missing category, group, category link or company
 * link is created, an existing one is left alone. It deliberately does NOT
 * overwrite — once the tree is here, the Category and Group screens own it, and
 * a redeploy must not undo a rename someone made deliberately.
 *
 * The key is the CODE. A code already present is a row that already exists,
 * whatever it is now called, so nothing is ever created twice and nothing is
 * ever renamed back.
 */
@Injectable()
export class InventoryTreeSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InventoryTreeSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const categories = await this.seedCategories();
      const groups = await this.seedGroups();
      const links = await this.seedLinks();
      if (categories || groups || links.categoryLinks || links.companyLinks) {
        this.logger.log(
          `Inventory tree seeded: +${categories} categories, +${groups} groups, ` +
            `+${links.categoryLinks} group-category links, ` +
            `+${links.companyLinks} company links.`,
        );
      }
    } catch (e) {
      // The classification tree is what the Item and Product masters hang off,
      // but a failure here must not stop the app booting — it is logged and
      // retried next start, same as the Chart of Accounts.
      this.logger.error(
        `Inventory tree seed failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * The company ids this database actually holds.
   *
   * The data file names companies by id, and companyId carries no foreign key
   * (the cross-domain rule), so nothing else would catch an id that is not
   * there — it would simply write a link to a company that does not exist.
   */
  private async companyIds(): Promise<Set<number>> {
    return new Set(
      (await this.prisma.company.findMany({ select: { id: true } })).map((c) => c.id),
    );
  }

  private async seedCategories(): Promise<number> {
    const existing = new Set(
      (await this.prisma.category.findMany({ select: { code: true } })).map(
        (c) => c.code,
      ),
    );
    const missing = INVENTORY_CATEGORIES.filter((c) => !existing.has(c.code));
    if (!missing.length) return 0;
    const res = await this.prisma.category.createMany({
      data: missing.map((c) => ({
        code: c.code,
        name: c.name,
        kind: c.kind,
        allCompanies: c.allCompanies,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  /**
   * Groups, parents first.
   *
   * By level rather than by the order of the data file: a sub-group needs its
   * parent's id, and a level-2 row seeded before its level-1 parent would have
   * nothing to hang on. The codes sort into that order anyway, but relying on
   * the sort would make the correctness of this depend on how the file happens
   * to be written.
   */
  private async seedGroups(): Promise<number> {
    let created = 0;
    const idByCode = new Map(
      (await this.prisma.group.findMany({ select: { id: true, code: true } })).map(
        (g) => [g.code, g.id],
      ),
    );

    for (const level of [...new Set(INVENTORY_GROUPS.map((g) => g.level))].sort(
      (a, b) => a - b,
    )) {
      for (const g of INVENTORY_GROUPS.filter((x) => x.level === level)) {
        if (idByCode.has(g.code)) continue;
        const parentGroupId = g.parentCode
          ? (idByCode.get(g.parentCode) ?? null)
          : null;
        if (g.parentCode && parentGroupId == null) {
          // Cannot happen with the shipped data, but a group silently hung at
          // the root would be worse than a loud skip.
          this.logger.warn(
            `Group ${g.code} (${g.name}) skipped: parent ${g.parentCode} missing.`,
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
        idByCode.set(g.code, row.id);
        created++;
      }
    }
    return created;
  }

  /**
   * The two link tables, for every seeded category and group — including ones
   * that were already here.
   *
   * Deliberately not folded into the creates above: the links are what put a
   * group on a screen and in a company, and a half-seeded database (tree
   * created, boot interrupted before the links) would otherwise stay broken for
   * ever, because the rows it needs already exist and would be skipped.
   */
  private async seedLinks(): Promise<{
    categoryLinks: number;
    companyLinks: number;
  }> {
    const companies = await this.companyIds();
    const catIdByCode = new Map(
      (await this.prisma.category.findMany({ select: { id: true, code: true } })).map(
        (c) => [c.code, c.id],
      ),
    );
    const groupIdByCode = new Map(
      (await this.prisma.group.findMany({ select: { id: true, code: true } })).map(
        (g) => [g.code, g.id],
      ),
    );
    const missingCompanies = new Set<number>();

    // ---- group → category ----
    const haveGroupCat = new Set(
      (
        await this.prisma.groupCategory.findMany({
          select: { groupId: true, categoryId: true },
        })
      ).map((r) => `${r.groupId}:${r.categoryId}`),
    );
    const groupCatRows: { groupId: number; categoryId: number }[] = [];
    for (const g of INVENTORY_GROUPS) {
      const groupId = groupIdByCode.get(g.code);
      if (groupId == null) continue;
      for (const catCode of g.categories) {
        const categoryId = catIdByCode.get(catCode);
        if (categoryId == null) continue;
        if (haveGroupCat.has(`${groupId}:${categoryId}`)) continue;
        groupCatRows.push({ groupId, categoryId });
      }
    }

    // ---- category → company, group → company ----
    const haveCatCo = new Set(
      (
        await this.prisma.categoryCompany.findMany({
          select: { categoryId: true, companyId: true },
        })
      ).map((r) => `${r.categoryId}:${r.companyId}`),
    );
    const catCoRows: { categoryId: number; companyId: number }[] = [];
    for (const c of INVENTORY_CATEGORIES) {
      const categoryId = catIdByCode.get(c.code);
      if (categoryId == null) continue;
      for (const companyId of c.companies) {
        if (!companies.has(companyId)) {
          missingCompanies.add(companyId);
          continue;
        }
        if (haveCatCo.has(`${categoryId}:${companyId}`)) continue;
        catCoRows.push({ categoryId, companyId });
      }
    }

    const haveGroupCo = new Set(
      (
        await this.prisma.groupCompany.findMany({
          select: { groupId: true, companyId: true },
        })
      ).map((r) => `${r.groupId}:${r.companyId}`),
    );
    const groupCoRows: { groupId: number; companyId: number }[] = [];
    for (const g of INVENTORY_GROUPS) {
      const groupId = groupIdByCode.get(g.code);
      if (groupId == null) continue;
      for (const companyId of g.companies) {
        if (!companies.has(companyId)) {
          missingCompanies.add(companyId);
          continue;
        }
        if (haveGroupCo.has(`${groupId}:${companyId}`)) continue;
        groupCoRows.push({ groupId, companyId });
      }
    }

    if (missingCompanies.size) {
      // Loud, because the tree is IN this database but reachable from no
      // company — which on screen looks exactly like a seed that did not run.
      this.logger.warn(
        `Inventory tree: company links skipped — no company with id ` +
          `${[...missingCompanies].sort((a, b) => a - b).join(', ')} in this ` +
          `database. Set those categories and groups against a company on ` +
          `their own screens, or they will not appear in any company picker.`,
      );
    }

    const [gc, cc, gco] = await Promise.all([
      groupCatRows.length
        ? this.prisma.groupCategory.createMany({
            data: groupCatRows,
            skipDuplicates: true,
          })
        : Promise.resolve({ count: 0 }),
      catCoRows.length
        ? this.prisma.categoryCompany.createMany({
            data: catCoRows,
            skipDuplicates: true,
          })
        : Promise.resolve({ count: 0 }),
      groupCoRows.length
        ? this.prisma.groupCompany.createMany({
            data: groupCoRows,
            skipDuplicates: true,
          })
        : Promise.resolve({ count: 0 }),
    ]);

    return { categoryLinks: gc.count, companyLinks: cc.count + gco.count };
  }
}

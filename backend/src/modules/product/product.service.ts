import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomKind, CategoryKind, Prisma, ProductSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  itemCode,
  itemSeqOf,
  lowestFree,
  MAX_ITEM_SEQ,
  withCategory,
} from '../../common/hierarchy-code';
import { extname } from 'path';
import { rename as renameFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { join } from 'path';
import {
  BomLineInput,
  CreateProductDto,
  PackSourceInput,
  ProcessInput,
  ProductBranchStockInput,
  ProductCompanyInput,
  UpdateProductDto,
} from './product.dto';
import { PRODUCT_UPLOAD_DIR, PRODUCT_URL_PREFIX } from './product.constants';

interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
}

/** The category kinds a PRODUCT may be filed under. */
const PRODUCT_KINDS: CategoryKind[] = ['SEMI_FINISHED', 'FINISHED'];

// Products are returned with their masters + company links flattened + the two
// BOMs split out of the single bomLines table.
const withRelations = {
  category: { select: { id: true, code: true, name: true } },
  group: { select: { id: true, code: true, name: true } },
  unit: { select: { id: true, code: true, name: true, symbol: true } },
  boxUnit: { select: { id: true, code: true, name: true, symbol: true } },
  yieldUnit: { select: { id: true, code: true, name: true, symbol: true } },
  hsnCode: { select: { id: true, code: true, description: true } },
  companies: {
    select: {
      companyId: true,
      canProduce: true,
      canSell: true,
      costCenterId: true,
      recipeCostObjectId: true,
      packingCostObjectId: true,
      costObjectId: true,
    },
  },
  deliveryTrips: { select: { lookupValueId: true } },
  discounts: { select: { lookupValueId: true, percentage: true } },
  packSources: {
    orderBy: { sequence: 'asc' },
    select: { id: true, sourceProductId: true, quantity: true, sequence: true },
  },
  branchStocks: {
    orderBy: { branchId: 'asc' },
    select: {
      id: true,
      branchId: true,
      minStock: true,
      maxStock: true,
      reorderLevel: true,
      leadTimeDays: true,
      defaultStoreId: true,
      defaultRackId: true,
    },
  },
  bomLines: {
    orderBy: { sequence: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true } },
      unit: { select: { id: true, code: true, name: true, symbol: true } },
    },
  },
  processes: {
    orderBy: { sequence: 'asc' },
    include: { manpower: true },
  },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof withRelations }>;

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  /** Store an uploaded product picture and return its public URL. */
  async uploadImage(file: UploadedFile): Promise<{ url: string }> {
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    const ext = extname(file.originalname) || extMap[file.mimetype] || '';
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    await renameFile(file.path, join(PRODUCT_UPLOAD_DIR, name));
    return { url: `${PRODUCT_URL_PREFIX}/${name}` };
  }

  async findAll(companyId: number | undefined, search?: string) {
    // A product is available exactly where it has a company row — there is no
    // "all companies" shortcut, since each company carries its own roles and
    // costing. With no active company nothing is in scope.
    const scopeFilter: Prisma.ProductWhereInput = companyId
      ? { companies: { some: { companyId } } }
      : { id: -1 };
    const rows = await this.prisma.product.findMany({
      where: {
        AND: [
          scopeFilter,
          search
            ? {
                OR: [
                  { code: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      include: withRelations,
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.flatten(r));
  }

  async findOne(companyId: number | undefined, id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!product || !this.isVisible(product, companyId)) {
      throw new NotFoundException('Product not found');
    }
    return this.flatten(product);
  }

  async create(dto: CreateProductDto) {
    await this.assertRefs(dto);
    // Every product lives under a leaf group AND names one of that group's
    // product categories. The code is generated from both (manual codes are not
    // accepted): the group supplies the level digits, the category the CC ones.
    const group = await this.assertLeafGroup(dto.groupId);
    const category = await this.assertCategoryOfGroup(dto.categoryId, group);
    const source = dto.source ?? 'MANUFACTURED';
    this.assertSourceAllowsBoms(source, {
      hasRecipe: dto.hasRecipe ?? false,
      hasPacking: dto.hasPacking ?? false,
      recipeLines: dto.recipe?.length ?? 0,
      packingLines: dto.packing?.length ?? 0,
      processes: dto.processes?.length ?? 0,
      packSources: dto.packSources?.length ?? 0,
    });
    const companies = await this.resolveCompanies(dto.companies, {
      hasRecipe: dto.hasRecipe ?? false,
      hasPacking: dto.hasPacking ?? false,
    });
    const discounts = await this.resolveDiscounts(
      dto.discounts,
      dto.canSell ?? true,
    );

    return this.withCodeRetry(async () => {
      const seq = await this.nextLeafSeq(dto.groupId);
      const created = await this.prisma.product.create({
        data: {
          code: withCategory(itemCode(group.code, seq), category.code),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          imageUrl: dto.imageUrl?.trim() || null,
          categoryId: category.id,
          groupId: dto.groupId,
          unitId: dto.unitId,
          unpacked: dto.unpacked ?? false,
          packed: dto.packed ?? false,
          canSell: dto.canSell ?? true,
          costPrice: dto.costPrice ?? 0,
          // A cost given at creation is established now; one left at zero has
          // never been costed at all, so it stays null.
          lastCostedAt: dto.costPrice ? new Date() : null,
          wholesalePrice: dto.wholesalePrice ?? 0,
          wholesaleProfitPct: dto.wholesaleProfitPct ?? 0,
          intercompanyPrice: dto.intercompanyPrice ?? 0,
          intercompanyProfitPct: dto.intercompanyProfitPct ?? 0,
          retailPrice: dto.retailPrice ?? 0,
          retailProfitPct: dto.retailProfitPct ?? 0,
          intercompanyTargetPct: dto.intercompanyTargetPct ?? null,
          wholesaleTargetPct: dto.wholesaleTargetPct ?? null,
          retailTargetPct: dto.retailTargetPct ?? null,
          maxVariancePct: dto.maxVariancePct ?? null,
          mrp: dto.mrp ?? 0,
          boxQty: dto.boxQty ?? 0,
          boxUnitId: dto.boxUnitId ?? null,
          hsnCodeId: dto.hsnCodeId ?? null,
          shelfLife: dto.shelfLife ?? 0,
          yieldQty: dto.yieldQty ?? 1,
          yieldUnitId: dto.yieldUnitId ?? null,
          labourCost: dto.labourCost ?? 0,
          fuelCost: dto.fuelCost ?? 0,
          overheadCost: dto.overheadCost ?? 0,
          bomMarginPct: dto.bomMarginPct ?? 0,
          actualCostPrice: dto.actualCostPrice ?? 0,
          actualSalesPrice: dto.actualSalesPrice ?? 0,
          source,
          hasRecipe: dto.hasRecipe ?? false,
          hasPacking: dto.hasPacking ?? false,
          isIngredient: dto.isIngredient ?? false,
          prodSun: dto.prodSun ?? false,
          prodMon: dto.prodMon ?? false,
          prodTue: dto.prodTue ?? false,
          prodWed: dto.prodWed ?? false,
          prodThu: dto.prodThu ?? false,
          prodFri: dto.prodFri ?? false,
          prodSat: dto.prodSat ?? false,
          prodOccasional: dto.prodOccasional ?? false,
          isActive: dto.isActive ?? true,
          companies: { create: companies },
          deliveryTrips: {
            create: (dto.deliveryTripIds ?? []).map((lookupValueId) => ({
              lookupValueId,
            })),
          },
          discounts: { create: discounts },
          bomLines: { create: this.bomCreate(dto.recipe, dto.packing) },
          processes: { create: this.processCreate(dto.processes) },
          packSources: { create: this.packSourceCreate(dto.packSources) },
          branchStocks: { create: this.branchStockCreate(dto.branchStocks) },
        },
        include: withRelations,
      });
      return this.flatten(created);
    });
  }

  /**
   * The group a product attaches to must be a leaf (no sub-groups) serving at
   * least one PRODUCT-kind category. Returns its categories + code, which the
   * caller needs to validate the chosen category and build the product's code.
   */
  private async assertLeafGroup(groupId: number) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        code: true,
        subGroupApplicable: true,
        isActive: true,
        categories: {
          select: { category: { select: { id: true, code: true, kind: true } } },
        },
      },
    });
    if (!group) {
      throw new BadRequestException('Selected group does not exist.');
    }
    if (!group.isActive) {
      throw new BadRequestException(
        'The selected group is inactive. Products cannot be added under it.',
      );
    }
    if (group.subGroupApplicable) {
      throw new BadRequestException(
        'Products cannot be added under a group that has sub-groups. Choose a leaf group.',
      );
    }
    const productCategories = group.categories
      .map((c) => c.category)
      .filter((c) => PRODUCT_KINDS.includes(c.kind));
    if (productCategories.length === 0) {
      throw new BadRequestException(
        'The selected group does not apply to products.',
      );
    }
    return { ...group, productCategories };
  }

   /**
   * Resale stock is bought ready-made, so a PURCHASED product may carry neither
   * bill of materials: no recipe or packing capability, and no BOM line,
   * process step or pack source. Rejecting it here is what keeps the flag
   * meaningful — otherwise "traded good" would drift into "manufactured product
   * someone forgot to give a recipe".
   *
   * `isIngredient` is deliberately NOT restricted: a bought-in filling or
   * topping can legitimately go into another product's recipe.
   */
  private assertSourceAllowsBoms(
    source: ProductSource,
    has: {
      hasRecipe: boolean;
      hasPacking: boolean;
      recipeLines: number;
      packingLines: number;
      processes: number;
      packSources: number;
    },
  ) {
    if (source !== 'PURCHASED') return;
    if (has.hasRecipe || has.hasPacking) {
      throw new BadRequestException(
        'A purchased (resale) product cannot have a recipe or packing bill of materials. Set it to Manufactured, or clear those options.',
      );
    }
    const held = [
      has.recipeLines && 'recipe lines',
      has.packingLines && 'packing lines',
      has.processes && 'process steps',
      has.packSources && 'packing sources',
    ].filter((s): s is string => Boolean(s));
    if (held.length) {
      throw new BadRequestException(
        `This product still has ${held.join(', ')}, so it cannot be marked as purchased (resale). Clear them under Production first.`,
      );
    }
  }

  /**
   * A product's category is CHOSEN, not inherited — it is what separates a
   * semi-finished from a finished product sharing the same group, and what each
   * product screen filters on. It must be one the group serves and must be a
   * product kind.
   */
  private async assertCategoryOfGroup(
    categoryId: number | null | undefined,
    group: {
      productCategories: { id: number; code: string; kind: CategoryKind }[];
    },
  ) {
    if (categoryId == null) {
      throw new BadRequestException('Select a category for this product.');
    }
    const category = group.productCategories.find((c) => c.id === categoryId);
    if (!category) {
      throw new BadRequestException(
        'The selected category is not one this group belongs to.',
      );
    }
    return category;
  }

  /** Lowest free 3-digit sequence under a leaf group (items + products share it). */
  private async nextLeafSeq(groupId: number): Promise<number> {
    const [items, products] = await Promise.all([
      this.prisma.item.findMany({ where: { groupId }, select: { code: true } }),
      this.prisma.product.findMany({ where: { groupId }, select: { code: true } }),
    ]);
    const used = [...items, ...products].map((r) => itemSeqOf(r.code));
    const n = lowestFree(used, MAX_ITEM_SEQ);
    if (n == null) {
      throw new BadRequestException(
        `Maximum of ${MAX_ITEM_SEQ} items/products reached under this group.`,
      );
    }
    return n;
  }

  private async withCodeRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (
          i < attempts &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  async update(companyId: number | undefined, id: number, dto: UpdateProductDto) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'product', 'editing');
    await this.assertRefs(dto);

    // The company rows carry the costing, and the activity objects depend on the
    // capability flags — so re-resolve against what the row will look like AFTER
    // this patch, not what it looks like now.
    const companies =
      dto.companies !== undefined
        ? await this.resolveCompanies(dto.companies, {
            hasRecipe: dto.hasRecipe ?? existing.hasRecipe,
            hasPacking: dto.hasPacking ?? existing.hasPacking,
          })
        : null;

    // Only touch the BOM / process flow when the caller sends them (Production
    // screen); the Inventory master screen omits them and leaves them intact.
    const wantsBomChange = dto.recipe !== undefined || dto.packing !== undefined;
    const recipe = (dto.recipe ?? existing.recipe).map(this.lineData);
    const packing = (dto.packing ?? existing.packing).map(this.lineData);
    const wantsProcessChange = dto.processes !== undefined;

    // Resale stock carries no bill of materials. Validate against what the row
    // will actually look like after this patch — the caller may be setting the
    // source and clearing the BOM in the same request, and an omitted field
    // means "leave it alone", not "empty".
    // The matrix is rewritten when the caller sends one, and cleared outright
    // when the product stops being sellable. null = leave it alone.
    const canSell = dto.canSell ?? existing.canSell;
    const discounts = !canSell
      ? []
      : dto.discounts !== undefined
        ? await this.resolveDiscounts(dto.discounts, canSell)
        : null;

    const source = dto.source ?? existing.source;
    this.assertSourceAllowsBoms(source, {
      hasRecipe: dto.hasRecipe ?? existing.hasRecipe,
      hasPacking: dto.hasPacking ?? existing.hasPacking,
      recipeLines: recipe.length,
      packingLines: packing.length,
      processes: (dto.processes ?? existing.processes).length,
      packSources: (dto.packSources ?? existing.packSources).length,
    });

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: {
          // code, categoryId and groupId are part of the hierarchy code and are
          // immutable after creation.
          name: dto.name?.trim(),
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,
          imageUrl:
            dto.imageUrl !== undefined ? dto.imageUrl?.trim() || null : undefined,
          unitId: dto.unitId,
          unpacked: dto.unpacked,
          packed: dto.packed,
          canSell: dto.canSell,
          costPrice: dto.costPrice,
          // Stamped only when the cost actually MOVES. Re-saving a form that
          // merely echoes the current cost back must not make a stale figure
          // look freshly established.
          lastCostedAt:
            dto.costPrice !== undefined && dto.costPrice !== existing.costPrice
              ? new Date()
              : undefined,
          wholesalePrice: dto.wholesalePrice,
          wholesaleProfitPct: dto.wholesaleProfitPct,
          intercompanyPrice: dto.intercompanyPrice,
          intercompanyProfitPct: dto.intercompanyProfitPct,
          retailPrice: dto.retailPrice,
          retailProfitPct: dto.retailProfitPct,
          intercompanyTargetPct: dto.intercompanyTargetPct,
          wholesaleTargetPct: dto.wholesaleTargetPct,
          retailTargetPct: dto.retailTargetPct,
          maxVariancePct: dto.maxVariancePct,
          mrp: dto.mrp,
          boxQty: dto.boxQty,
          boxUnitId: dto.boxUnitId,
          hsnCodeId: dto.hsnCodeId,
          shelfLife: dto.shelfLife,
          yieldQty: dto.yieldQty,
          yieldUnitId: dto.yieldUnitId,
          labourCost: dto.labourCost,
          fuelCost: dto.fuelCost,
          overheadCost: dto.overheadCost,
          bomMarginPct: dto.bomMarginPct,
          actualCostPrice: dto.actualCostPrice,
          actualSalesPrice: dto.actualSalesPrice,
          source: dto.source,
          hasRecipe: dto.hasRecipe,
          hasPacking: dto.hasPacking,
          isIngredient: dto.isIngredient,
          prodSun: dto.prodSun,
          prodMon: dto.prodMon,
          prodTue: dto.prodTue,
          prodWed: dto.prodWed,
          prodThu: dto.prodThu,
          prodFri: dto.prodFri,
          prodSat: dto.prodSat,
          prodOccasional: dto.prodOccasional,
          isActive: dto.isActive,
          // Only rewrite the trips when the caller sent them: omitting the field
          // must leave the schedule alone, not silently clear it.
          ...(dto.deliveryTripIds !== undefined
            ? {
                deliveryTrips: {
                  deleteMany: {},
                  create: dto.deliveryTripIds.map((lookupValueId) => ({
                    lookupValueId,
                  })),
                },
              }
            : {}),
          // Same rule for the discount matrix — except that turning Can Sell
          // off clears it whether or not the caller sent one, since a product
          // that isn't sold has nothing to discount.
          ...(discounts
            ? { discounts: { deleteMany: {}, create: discounts } }
            : {}),
          ...(companies
            ? { companies: { deleteMany: {}, create: companies } }
            : {}),
          ...(wantsBomChange
            ? {
                bomLines: {
                  deleteMany: {},
                  create: this.bomCreate(recipe, packing),
                },
              }
            : {}),
          ...(wantsProcessChange
            ? {
                processes: {
                  deleteMany: {},
                  create: this.processCreate(dto.processes),
                },
              }
            : {}),
          ...(dto.packSources !== undefined
            ? {
                packSources: {
                  deleteMany: {},
                  create: this.packSourceCreate(dto.packSources),
                },
              }
            : {}),
          ...(dto.branchStocks !== undefined
            ? {
                branchStocks: {
                  deleteMany: {},
                  create: this.branchStockCreate(dto.branchStocks),
                },
              }
            : {}),
        },
        include: withRelations,
      });
      return this.flatten(updated);
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async setLock(companyId: number | undefined, id: number, locked: boolean) {
    await this.findOne(companyId, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isLocked: locked },
      include: withRelations,
    });
    return this.flatten(updated);
  }

  async remove(companyId: number | undefined, id: number) {
    const existing = await this.findOne(companyId, id);
    assertUnlocked(existing, 'product', 'deleting');
    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  /**
   * Validate + normalise the discount matrix into rows ready to create.
   *
   * A product that isn't sold has nothing to discount, so a non-sellable
   * product always resolves to an empty matrix regardless of what was sent.
   * Zero-percent rows are dropped rather than stored: "no discount" is the
   * absence of a row, which keeps the table to what the user actually set.
   *
   * Every level must be a live value of the DISCOUNT_LEVEL lookup — ids are
   * accepted from the client, so a stale or foreign id must not be persisted as
   * a discount nobody can see.
   */
  private async resolveDiscounts(
    rows: { lookupValueId: number; percentage: number }[] | undefined,
    canSell: boolean,
  ): Promise<{ lookupValueId: number; percentage: number }[]> {
    if (!canSell || !rows?.length) return [];

    const wanted = new Map<number, number>();
    for (const r of rows) wanted.set(r.lookupValueId, r.percentage);

    const valid = await this.prisma.lookupValue.findMany({
      where: {
        id: { in: [...wanted.keys()] },
        lookup: { code: 'DISCOUNT_LEVEL' },
      },
      select: { id: true },
    });
    if (valid.length !== wanted.size) {
      throw new BadRequestException(
        'One of the discount levels does not exist. Reload the screen and try again.',
      );
    }
    return [...wanted.entries()]
      .filter(([, percentage]) => percentage > 0)
      .map(([lookupValueId, percentage]) => ({ lookupValueId, percentage }));
  }

  private flatten(row: ProductRow) {
    const { companies, deliveryTrips, discounts, bomLines, ...rest } = row;
    const toLine = (l: ProductRow['bomLines'][number]) => ({
      id: l.id,
      itemId: l.itemId,
      quantity: l.quantity,
      unitId: l.unitId,
      sequence: l.sequence,
      item: l.item,
      unit: l.unit,
    });
    return {
      ...rest,
      companies,
      // Kept for the many screens that only ask "which companies is it in".
      companyIds: companies.map((c) => c.companyId),
      deliveryTripIds: deliveryTrips.map((t) => t.lookupValueId),
      discounts: discounts.map((d) => ({
        lookupValueId: d.lookupValueId,
        percentage: d.percentage,
      })),
      recipe: bomLines.filter((l) => l.kind === BomKind.RECIPE).map(toLine),
      packing: bomLines.filter((l) => l.kind === BomKind.PACKING).map(toLine),
    };
  }

  private lineData(l: { itemId: number; quantity: number; unitId: number }) {
    return { itemId: l.itemId, quantity: l.quantity, unitId: l.unitId };
  }

  /** Build ProductBomLine create rows from the two BOM arrays. */
  private bomCreate(
    recipe: BomLineInput[] | undefined,
    packing: BomLineInput[] | undefined,
  ): Prisma.ProductBomLineUncheckedCreateWithoutProductInput[] {
    const rows = (lines: BomLineInput[] | undefined, kind: BomKind) =>
      (lines ?? []).map((l, i) => ({
        kind,
        sequence: i,
        itemId: l.itemId,
        quantity: l.quantity,
        unitId: l.unitId,
      }));
    return [
      ...rows(recipe, BomKind.RECIPE),
      ...rows(packing, BomKind.PACKING),
    ];
  }

  /** Build ProductPackSource create rows from the packing sources array. */
  private packSourceCreate(
    sources: PackSourceInput[] | undefined,
  ): Prisma.ProductPackSourceUncheckedCreateWithoutProductInput[] {
    return (sources ?? []).map((s, i) => ({
      sequence: i,
      sourceProductId: s.sourceProductId,
      quantity: s.quantity,
    }));
  }

  /** Build ProductBranchStock create rows. Rows whose levels are all zero are
   *  dropped so the table only holds branches the user actually configured. */
  private branchStockCreate(
    rows: ProductBranchStockInput[] | undefined,
  ): Prisma.ProductBranchStockUncheckedCreateWithoutProductInput[] {
    const seen = new Set<number>();
    return (rows ?? [])
      .filter((r) => {
        // Guard against duplicate branchIds (unique on [productId, branchId]).
        if (seen.has(r.branchId)) return false;
        seen.add(r.branchId);
        return (
          (r.minStock ?? 0) > 0 ||
          (r.maxStock ?? 0) > 0 ||
          (r.reorderLevel ?? 0) > 0 ||
          (r.leadTimeDays ?? 0) > 0 ||
          // Keep a row that only sets a put-away location — the default store /
          // rack is worth persisting even with no stock levels configured.
          r.defaultStoreId != null ||
          r.defaultRackId != null
        );
      })
      .map((r) => ({
        branchId: r.branchId,
        minStock: r.minStock ?? 0,
        maxStock: r.maxStock ?? 0,
        reorderLevel: r.reorderLevel ?? 0,
        leadTimeDays: r.leadTimeDays ?? 0,
        defaultStoreId: r.defaultStoreId ?? null,
        defaultRackId: r.defaultRackId ?? null,
      }));
  }

  /** Build ProductProcess create rows from the process-flow array. */
  private processCreate(
    processes: ProcessInput[] | undefined,
  ): Prisma.ProductProcessUncheckedCreateWithoutProductInput[] {
    return (processes ?? []).map((p, i) => ({
      sequence: i,
      name: p.name.trim(),
      description: p.description?.trim() || null,
      timeValue: p.timeValue ?? 0,
      timeUnit: p.timeUnit ?? 'MIN',
      machineId: p.machineId ?? null,
      manpower: {
        create: (p.manpower ?? []).map((m) => ({
          designationId: m.designationId,
          workerCount: m.workerCount,
        })),
      },
    }));
  }

  private isVisible(
    product: { companies: { companyId: number }[] },
    companyId: number | undefined,
  ): boolean {
    return companyId != null
      ? product.companies.some((c) => c.companyId === companyId)
      : false;
  }

  /** Verify every referenced master id (incl. each BOM line item/unit) exists. */
  private async assertRefs(dto: CreateProductDto | UpdateProductDto) {
    const exists = async (
      model: 'unit' | 'category' | 'group' | 'hsnCode' | 'item',
      id: number,
    ): Promise<boolean> => {
      const sel = { select: { id: true }, where: { id } };
      switch (model) {
        case 'unit':
          return !!(await this.prisma.unit.findUnique(sel));
        case 'category':
          return !!(await this.prisma.category.findUnique(sel));
        case 'group':
          return !!(await this.prisma.group.findUnique(sel));
        case 'hsnCode':
          return !!(await this.prisma.hsnCode.findUnique(sel));
        case 'item':
          return !!(await this.prisma.item.findUnique(sel));
      }
    };

    if (dto.unitId != null && !(await exists('unit', dto.unitId))) {
      throw new BadRequestException('Selected unit does not exist.');
    }
    if (dto.boxUnitId != null && !(await exists('unit', dto.boxUnitId))) {
      throw new BadRequestException('Selected box unit does not exist.');
    }
    if (dto.yieldUnitId != null && !(await exists('unit', dto.yieldUnitId))) {
      throw new BadRequestException('Selected yield unit does not exist.');
    }
    if (dto.categoryId != null && !(await exists('category', dto.categoryId))) {
      throw new BadRequestException('Selected category does not exist.');
    }
    if (dto.groupId != null && !(await exists('group', dto.groupId))) {
      throw new BadRequestException('Selected group does not exist.');
    }
    if (dto.hsnCodeId != null && !(await exists('hsnCode', dto.hsnCodeId))) {
      throw new BadRequestException('Selected HSN code does not exist.');
    }
    for (const l of [...(dto.recipe ?? []), ...(dto.packing ?? [])]) {
      if (!(await exists('item', l.itemId))) {
        throw new BadRequestException('A BOM line references an item that does not exist.');
      }
      if (!(await exists('unit', l.unitId))) {
        throw new BadRequestException('A BOM line references a unit that does not exist.');
      }
    }
  }

  /**
   * Validate + normalise the per-company rows: which companies handle this
   * product, in what role, and against which costing.
   *
   * The costing rules follow the role rather than the transaction type — buying,
   * making and selling in one company all hit the same cost centre, so only ONE
   * is named per company. What varies is the ACTIVITY: a producer names a cost
   * object per activity (recipe / packing), a company that only buys and sells
   * names a single one. Objects that don't apply to the role are dropped rather
   * than stored, so a company later switched from producer to trader doesn't
   * keep stale activity objects.
   *
   * Every cost centre must belong to that same company, and every cost object
   * must sit under the chosen centre — ids come from the client, so a mismatched
   * pair would otherwise post cost against another company's books.
   */
  private async resolveCompanies(
    rows: ProductCompanyInput[] | undefined,
    caps: { hasRecipe: boolean; hasPacking: boolean },
  ): Promise<Prisma.ProductCompanyCreateWithoutProductInput[]> {
    const wanted = new Map<number, ProductCompanyInput>();
    for (const r of rows ?? []) {
      if (r.companyId > 0) wanted.set(r.companyId, r);
    }
    if (wanted.size === 0) {
      throw new BadRequestException(
        'Select at least one company that produces or sells this product.',
      );
    }
    for (const r of wanted.values()) {
      if (!r.canProduce && !r.canSell) {
        throw new BadRequestException(
          'Each company must either produce or sell the product (or both).',
        );
      }
    }

    // Resolve every referenced cost centre / object in one go, so the checks
    // below are plain lookups.
    const centreIds = [
      ...new Set(
        [...wanted.values()]
          .map((r) => r.costCenterId)
          .filter((n): n is number => n != null),
      ),
    ];
    const objectIds = [
      ...new Set(
        [...wanted.values()]
          .flatMap((r) => [
            r.recipeCostObjectId,
            r.packingCostObjectId,
            r.costObjectId,
          ])
          .filter((n): n is number => n != null),
      ),
    ];
    const [centres, objects] = await Promise.all([
      this.prisma.costCenter.findMany({
        where: { id: { in: centreIds } },
        select: { id: true, companyId: true },
      }),
      this.prisma.costObject.findMany({
        where: { id: { in: objectIds } },
        select: { id: true, companyId: true, costCenterId: true },
      }),
    ]);
    const centreById = new Map(centres.map((c) => [c.id, c]));
    const objectById = new Map(objects.map((o) => [o.id, o]));

    return [...wanted.values()].map((r) => {
      if (r.costCenterId != null) {
        const centre = centreById.get(r.costCenterId);
        if (!centre || centre.companyId !== r.companyId) {
          throw new BadRequestException(
            'A cost centre does not belong to the company it was chosen for.',
          );
        }
      }
      const objectOf = (id: number | null | undefined) => {
        if (id == null) return null;
        const obj = objectById.get(id);
        if (!obj || obj.companyId !== r.companyId) {
          throw new BadRequestException(
            'A cost object does not belong to the company it was chosen for.',
          );
        }
        if (r.costCenterId != null && obj.costCenterId !== r.costCenterId) {
          throw new BadRequestException(
            'A cost object does not sit under the cost centre chosen for that company.',
          );
        }
        return id;
      };

      return {
        companyId: r.companyId,
        canProduce: r.canProduce ?? false,
        canSell: r.canSell ?? true,
        costCenterId: r.costCenterId ?? null,
        // Activity objects apply to a producer only, and only for the BOMs the
        // product actually has.
        recipeCostObjectId:
          r.canProduce && caps.hasRecipe ? objectOf(r.recipeCostObjectId) : null,
        packingCostObjectId:
          r.canProduce && caps.hasPacking
            ? objectOf(r.packingCostObjectId)
            : null,
        // A producer's costing is carried by the activity objects above; the
        // single object is for a company that only buys and sells.
        costObjectId: r.canProduce ? null : objectOf(r.costObjectId),
      };
    });
  }

  private asDuplicate(e: unknown, code?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(`Product code "${code}" already exists.`);
    }
    return e;
  }
}

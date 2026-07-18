import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import { RECIPE, RecipePort } from '../../contracts/recipe.port';
import {
  ProducedBatch,
  STOCK_POSTING,
  StockPostingPort,
} from '../../contracts/stock-posting.port';
import { CreatePackingDto } from './packing.dto';

const PACKING_DOCUMENT_CODE = 'PACKING';

const withLines = {
  lines: { orderBy: { productName: 'asc' as const } },
};

/**
 * Packing operations — turn unpacked products into packed, sellable ones. Each
 * packed line consumes its unpacked source(s) and packing materials from stock
 * (via the recipe/packing explosion) and banks the packed product as a new
 * batch (through the STOCK_POSTING port).
 */
@Injectable()
export class PackingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
    @Inject(RECIPE) private readonly recipe: RecipePort,
    @Inject(STOCK_POSTING) private readonly posting: StockPostingPort,
  ) {}

  findAll(companyId: number | undefined, search?: string) {
    if (!companyId) return [];
    return this.prisma.packing.findMany({
      where: {
        companyId,
        ...(search
          ? { packingNo: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: withLines,
    });
  }

  async findOne(id: number) {
    const packing = await this.prisma.packing.findUnique({
      where: { id },
      include: withLines,
    });
    if (!packing) throw new NotFoundException('Packing not found.');
    return packing;
  }

  async create(
    userId: number,
    companyId: number | undefined,
    branchId: number | undefined,
    dto: CreatePackingDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');

    // Every line must be a PACKED product.
    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, packed: true, name: true },
    });
    const prodById = new Map(products.map((p) => [p.id, p]));
    for (const l of dto.lines) {
      const p = prodById.get(l.productId);
      if (!p) throw new BadRequestException('Product not found.');
      if (!p.packed) {
        throw new BadRequestException(
          `"${p.name}" is not a packed product and cannot be packed.`,
        );
      }
    }

    const store = await this.resolveStore(companyId, branchId, dto.storeId);
    if (!store) {
      throw new BadRequestException(
        'Set a default store (or choose one) before packing.',
      );
    }

    // What each packed quantity consumes (unpacked sources + packing materials).
    const demand = dto.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
    }));
    const explosion = await this.recipe.explodePacking(companyId, demand);
    if (!explosion.consumeProducts.length && !explosion.consumeItems.length) {
      throw new BadRequestException(
        'These products have no packing source or materials defined.',
      );
    }

    // Header first — it is the document the stock movements belong to.
    const header = await this.withPackingNoRetry(companyId, (packingNo) =>
      this.prisma.packing.create({
        data: {
          companyId,
          branchId: branchId ?? null,
          packingNo,
          storeId: store.id,
          storeName: store.name,
          notes: dto.notes?.trim() || null,
          createdByUserId: userId,
        },
      }),
    );

    // Consume sources + materials, produce the packed batches (atomic). If the
    // posting fails (e.g. short stock), drop the header so no empty packing is
    // left behind.
    let batches: ProducedBatch[];
    try {
      batches = await this.posting.postPacking({
        companyId,
        branchId: branchId ?? null,
        storeId: store.id,
        documentId: header.id,
        documentNo: header.packingNo,
        date: new Date().toISOString(),
        produce: dto.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
        })),
        consumeProducts: explosion.consumeProducts.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
        })),
        consumeItems: explosion.consumeItems.map((c) => ({
          itemId: c.itemId,
          quantity: c.quantity,
        })),
      });
    } catch (e) {
      await this.prisma.packing.delete({ where: { id: header.id } });
      throw e;
    }
    const batchOf = new Map(batches.map((b) => [b.productId, b]));

    await this.prisma.packingLine.createMany({
      data: dto.lines.map((l) => {
        const b = batchOf.get(l.productId);
        return {
          packingId: header.id,
          productId: l.productId,
          productName: prodById.get(l.productId)?.name ?? `#${l.productId}`,
          quantity: l.quantity,
          unitId: b?.unitId ?? 0,
          batchId: b?.batchId ?? null,
          batchNo: b?.batchNo ?? null,
          expiryDate: b?.expiryDate ? new Date(b.expiryDate) : null,
        };
      }),
    });

    return this.findOne(header.id);
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.packing.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  // --- helpers ---

  private async resolveStore(
    companyId: number,
    branchId: number | undefined,
    storeId: number | undefined,
  ): Promise<{ id: number; name: string } | null> {
    if (storeId) {
      const s = await this.prisma.store.findFirst({
        where: { id: storeId, companyId },
        select: { id: true, name: true },
      });
      if (!s) throw new BadRequestException('That store is not in this company.');
      return s;
    }
    return (
      (await this.prisma.store.findFirst({
        where: {
          companyId,
          isDefault: true,
          ...(branchId ? { branchId } : {}),
        },
        select: { id: true, name: true },
      })) ??
      (await this.prisma.store.findFirst({
        where: { companyId, isDefault: true },
        select: { id: true, name: true },
      })) ??
      null
    );
  }

  private async withPackingNoRetry<T>(
    companyId: number,
    fn: (packingNo: string) => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    for (let i = 0; ; i++) {
      const packingNo = await this.nextPackingNo(companyId, i);
      try {
        return await fn(packingNo);
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

  private async nextPackingNo(
    companyId: number,
    attempt: number,
  ): Promise<string> {
    const configured = await this.numbering.next(
      companyId,
      PACKING_DOCUMENT_CODE,
    );
    if (configured) return configured;
    const n = await this.prisma.packing.count({ where: { companyId } });
    return `PK-${String(n + 1 + attempt).padStart(4, '0')}`;
  }
}

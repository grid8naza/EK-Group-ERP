import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateDocumentDto, UpdateDocumentDto } from './document.dto';

/** System documents wired to a real numbered flow (seeded on boot). */
const SYSTEM_DOCUMENTS: { code: string; name: string }[] = [
  { code: 'OPENING_STOCK', name: 'Opening Stock' },
  { code: 'PURCHASE_ORDER_IC', name: 'Purchase Order - IC' },
];

@Injectable()
export class DocumentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentService.name);

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const d of SYSTEM_DOCUMENTS) {
        await this.prisma.document.upsert({
          where: { code: d.code },
          create: { code: d.code, name: d.name, isSystem: true },
          update: { isSystem: true },
        });
      }
    } catch (e) {
      this.logger.error(
        `Seeding system documents failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  findAll(search?: string) {
    return this.prisma.document.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async create(dto: CreateDocumentDto) {
    const code = this.slug(dto.code || dto.name);
    try {
      return await this.prisma.document.create({
        data: {
          code,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A document with code "${code}" already exists.`);
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateDocumentDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'document', 'editing');
    return this.prisma.document.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
        isActive: dto.isActive,
      },
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.document.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'document', 'deleting');
    if (existing.isSystem) {
      throw new BadRequestException('System documents cannot be deleted.');
    }
    await this.prisma.document.delete({ where: { id } });
    return { success: true };
  }

  /** A stable UPPER_SNAKE code from a name. */
  private slug(s: string): string {
    return (
      s
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'DOC'
    );
  }
}

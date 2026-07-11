import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateHsnCodeDto, UpdateHsnCodeDto } from './hsn.dto';

@Injectable()
export class HsnService {
  constructor(private prisma: PrismaService) {}

  findAll(search?: string) {
    return this.prisma.hsnCode.findMany({
      where: search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: number) {
    const hsn = await this.prisma.hsnCode.findUnique({ where: { id } });
    if (!hsn) throw new NotFoundException('HSN code not found');
    return hsn;
  }

  async create(dto: CreateHsnCodeDto) {
    try {
      return await this.prisma.hsnCode.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          description: dto.description.trim(),
          cgst: dto.cgst ?? 0,
          sgst: dto.sgst ?? 0,
          igst: dto.igst ?? 0,
          cess: dto.cess ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async update(id: number, dto: UpdateHsnCodeDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'HSN code', 'editing');
    try {
      return await this.prisma.hsnCode.update({
        where: { id },
        data: {
          code: dto.code !== undefined ? dto.code.trim().toUpperCase() : undefined,
          description: dto.description?.trim(),
          cgst: dto.cgst,
          sgst: dto.sgst,
          igst: dto.igst,
          cess: dto.cess,
          isActive: dto.isActive,
        },
      });
    } catch (e) {
      throw this.asDuplicate(e, dto.code);
    }
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.hsnCode.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'HSN code', 'deleting');
    await this.prisma.hsnCode.delete({ where: { id } });
    return { success: true };
  }

  private asDuplicate(e: unknown, code?: string): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(`HSN code "${code}" already exists.`);
    }
    return e;
  }
}

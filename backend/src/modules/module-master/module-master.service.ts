import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateModuleDto, UpdateModuleDto } from './module-master.dto';

@Injectable()
export class ModuleMasterService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.module.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async findOne(id: number) {
    const module = await this.prisma.module.findUnique({ where: { id } });
    if (!module) throw new NotFoundException('Module not found');
    return module;
  }

  create(dto: CreateModuleDto) {
    return this.prisma.module.create({ data: dto });
  }

  async update(id: number, dto: UpdateModuleDto) {
    await this.findOne(id);
    return this.prisma.module.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const module = await this.findOne(id);
    if (module.isCore)
      throw new BadRequestException('Core modules cannot be removed');
    await this.prisma.module.delete({ where: { id } });
    return { success: true };
  }
}

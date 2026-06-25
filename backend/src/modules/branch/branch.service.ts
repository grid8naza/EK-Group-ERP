import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { CreateBranchDto, UpdateBranchDto } from './branch.dto';

@Injectable()
export class BranchService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId?: number) {
    return this.prisma.branch.findMany({
      where: companyId ? { companyId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(dto: CreateBranchDto) {
    // Branches may only be created for companies that opted into branches.
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { branchApplicable: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    if (!company.branchApplicable) {
      throw new ConflictException(
        'This company is not branch-applicable. Enable "Branch Applicable" on the company first.',
      );
    }
    return this.prisma.branch.create({ data: dto });
  }

  async update(id: number, dto: UpdateBranchDto) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'branch', 'editing');
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async setLock(id: number, locked: boolean) {
    await this.findOne(id);
    return this.prisma.branch.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    assertUnlocked(existing, 'branch', 'deleting');

    // Block deletion while users are still granted access to this branch —
    // deleting would silently drop their branch access (pattern from
    // CompanyService.remove).
    const users = await this.prisma.user.findMany({
      where: { branches: { some: { branchId: id } } },
      select: { name: true, username: true },
      orderBy: { name: 'asc' },
    });
    if (users.length > 0) {
      const MAX = 10;
      const shown = users.slice(0, MAX).map((u) => `${u.name} (${u.username})`);
      const extra = users.length - shown.length;
      const list = shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');
      throw new ConflictException(
        `Cannot delete this branch — ${users.length} user(s) still have access to it: ${list}. Remove their branch access first.`,
      );
    }

    await this.prisma.branch.delete({ where: { id } });
    return { success: true };
  }
}

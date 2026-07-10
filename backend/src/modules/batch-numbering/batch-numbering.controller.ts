import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BatchNumberingService } from './batch-numbering.service';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { SaveBatchNumberingRuleDto } from './batch-numbering.dto';

/** `company` (or 0) in the branch path segment means the company-level rule. */
function parseBranch(v: string): number | null {
  if (v === 'company' || v === 'null' || v === '0') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Batch Numbering (Cpanel) — per-company + branch sequencer for stock batches. */
@ApiTags('batch-numbering')
@ApiBearerAuth()
@Controller('batch-numbering')
export class BatchNumberingController {
  constructor(private readonly service: BatchNumberingService) {}

  @Get()
  overview(@CompanyId() companyId: number | undefined) {
    return this.service.overview(companyId);
  }

  @Put()
  save(
    @CompanyId() companyId: number | undefined,
    @Body() dto: SaveBatchNumberingRuleDto,
  ) {
    return this.service.save(companyId, dto);
  }

  @Delete(':branchId')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('branchId') branchId: string,
  ) {
    return this.service.remove(companyId, parseBranch(branchId));
  }

  @UseGuards(LockPrivilegeGuard('/cpanel/batch-numbering'))
  @Patch(':branchId/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('branchId') branchId: string,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, parseBranch(branchId), dto.locked);
  }
}

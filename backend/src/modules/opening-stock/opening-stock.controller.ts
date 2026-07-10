import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OpeningStockService } from './opening-stock.service';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import {
  CreateOpeningStockDto,
  UpdateOpeningStockDto,
} from './opening-stock.dto';

/**
 * Opening Stock (Inventory) — the opening-balance document. Each line generates
 * a system batch number and writes a StockLedger stock-in row.
 */
@ApiTags('opening-stock')
@ApiBearerAuth()
@Controller('opening-stock')
export class OpeningStockController {
  constructor(private readonly service: OpeningStockService) {}

  @Get()
  findAll(@CompanyId() companyId: number | undefined) {
    return this.service.findAll(companyId);
  }

  /** Flat enriched lines for the line-grid listing (by stockable type). */
  @Get('lines')
  lines(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('type') type?: string,
  ) {
    const allowed = [
      'ITEM_RAW',
      'ITEM_PACKING',
      'PRODUCT_PACKED',
      'PRODUCT_UNPACKED',
    ] as const;
    const t = (allowed as readonly string[]).includes(type ?? '')
      ? (type as (typeof allowed)[number])
      : 'ITEM_RAW';
    return this.service.lines(companyId, branchId, t);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: CreateOpeningStockDto,
  ) {
    return this.service.create(companyId, branchId, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: UpdateOpeningStockDto,
  ) {
    return this.service.update(id, companyId, branchId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @UseGuards(
    LockPrivilegeGuard([
      '/inventory/opening-stock-raw-material',
      '/inventory/opening-stock-packing-material',
      '/inventory/opening-stock-unpacked-products',
      '/inventory/opening-stock-packed-products',
    ]),
  )
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}

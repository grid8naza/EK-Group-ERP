import {
  BadRequestException,
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
import {
  StockTransactionService,
  TXN_TYPES,
  type TxnType,
} from './stock-transaction.service';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import {
  CreateStockTransactionDto,
  UpdateStockTransactionDto,
} from './stock-transaction.dto';

/** Parse + validate the ?type= query into a supported transaction type. */
function parseType(type?: string): TxnType {
  if (!type || !(TXN_TYPES as readonly string[]).includes(type)) {
    throw new BadRequestException(
      `type must be one of ${TXN_TYPES.join(', ')}.`,
    );
  }
  return type as TxnType;
}

/**
 * Inventory Transactions — Goods Receipt (PURCHASE), Delivery (SALE), Goods
 * Return (RETURN) and Goods Issue / Consumption (CONSUMPTION). One controller,
 * the ?type= query selects the note. IN types add stock (+ a batch); OUT types
 * decrement it (validated against on-hand).
 */
@ApiTags('stock-transactions')
@ApiBearerAuth()
@Controller('stock-transactions')
export class StockTransactionController {
  constructor(private readonly service: StockTransactionService) {}

  /** Flat enriched lines for the listing grid (by transaction type). */
  @Get('lines')
  lines(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('type') type?: string,
  ) {
    return this.service.lines(companyId, branchId, parseType(type));
  }

  /** One row per document (header listing). */
  @Get('documents')
  documents(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('type') type?: string,
  ) {
    return this.service.documents(companyId, branchId, parseType(type));
  }

  /**
   * Intercompany shipments heading for this company that have not been received
   * yet — the Goods Receipt Note picks one to receive against.
   */
  @Get('incoming-dispatches')
  incomingDispatches(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
  ) {
    return this.service.incomingDispatches(companyId, branchId);
  }

  /**
   * The purchase register: goods receipt lines with supplier, item, batch and
   * rate. Declared ABOVE :id, or "purchase-register" is read as an id.
   */
  @Get('purchase-register')
  purchaseRegister(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('supplierId') supplierId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('storeId') storeId?: string,
  ) {
    // Number(), not ParseIntPipe({ optional: true }) — that 400s on a filter
    // simply not being used.
    const num = (v?: string) => (v ? Number(v) || undefined : undefined);
    const day = (v?: string) => (v ? new Date(v) : undefined);
    return this.service.purchaseRegister(companyId, branchId, {
      from: day(from),
      // Inclusive of the closing day: a receipt at 14:00 on the 31st is inside
      // "to 31st", which is what anyone means by it.
      to: to ? new Date(`${to}T23:59:59.999`) : undefined,
      supplierId: num(supplierId),
      categoryId: num(categoryId),
      storeId: num(storeId),
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Query('type') type: string | undefined,
    @Body() dto: CreateStockTransactionDto,
  ) {
    return this.service.create(companyId, branchId, parseType(type), dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
    @Body() dto: UpdateStockTransactionDto,
  ) {
    return this.service.update(id, companyId, branchId, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @UseGuards(
    LockPrivilegeGuard([
      '/inventory/goods-receipt-note',
      '/inventory/delivery-note',
      '/inventory/sales-return',
      '/inventory/purchase-return',
      '/inventory/goods-issue-note',
    ]),
  )
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}

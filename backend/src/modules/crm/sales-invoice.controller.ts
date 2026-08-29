import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { SalesInvoiceService } from './sales-invoice.service';
import {
  CreateSalesInvoiceDto,
  EInvoiceDto,
  EwayBillDto,
  UpdateSalesInvoiceDto,
} from './sales-invoice.dto';

/**
 * Sales Invoices — the GST bill, raised against a delivery note.
 *
 * Never deleted, only cancelled: a number that was issued stays in the series,
 * because a GST series with a hole in it is a hole somebody has to explain.
 */
@ApiTags('sales-invoices')
@ApiBearerAuth()
@Controller('sales-invoices')
export class SalesInvoiceController {
  constructor(private readonly service: SalesInvoiceService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: number | undefined,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.service.createFromDeliveryNote(user.id, companyId, dto);
  }

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('customerId') customerId?: string,
  ) {
    // Number(), not ParseIntPipe — an optional pipe 400s on an absent param.
    const c = Number(customerId);
    return this.service.findAll(
      companyId,
      Number.isInteger(c) && c > 0 ? c : undefined,
    );
  }

  /** Delivery notes with no invoice yet — what the billing screen offers. */
  @Get('unbilled')
  unbilled(
    @CompanyId() companyId: number | undefined,
    @BranchId() branchId: number | undefined,
  ) {
    return this.service.unbilledDeliveryNotes(companyId, branchId);
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSalesInvoiceDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Post(':id/issue')
  issue(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.issue(companyId, id);
  }

  @Post(':id/cancel')
  cancel(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.service.cancel(companyId, id, body?.reason);
  }

  /**
   * Record what the IRP returned. Hand-entered today; when the upload is wired
   * it will call this same path with the same shape.
   */
  @Patch(':id/e-invoice')
  setEInvoice(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EInvoiceDto,
  ) {
    return this.service.setEInvoice(companyId, id, dto);
  }

  @Patch(':id/eway-bill')
  setEwayBill(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EwayBillDto,
  ) {
    return this.service.setEwayBill(companyId, id, dto);
  }
}

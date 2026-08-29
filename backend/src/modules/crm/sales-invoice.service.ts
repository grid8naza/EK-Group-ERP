import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GstSupplyType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import { gstStateCode, gstStateName } from '../../common/gst-states';
import { NUMBERING, NumberingPort } from '../../contracts/numbering.port';
import {
  CreateSalesInvoiceDto,
  EInvoiceDto,
  EwayBillDto,
  UpdateSalesInvoiceDto,
} from './sales-invoice.dto';

const INVOICE_DOCUMENT_CODE = 'SALES_INVOICE';

const withLines = {
  lines: { orderBy: { sequence: 'asc' as const } },
};

/** To the paisa. Tax is money, and money does not carry float noise. */
const paisa = (n: number) => Math.round(n * 100) / 100;

/**
 * Sales Invoices — the statutory GST document, raised against a DELIVERY NOTE.
 *
 * One invoice per delivery, which is how a contract customer is billed: the
 * agreement says what should go out each day, the delivery note says what
 * actually went, and the invoice charges for that. Billing the contract instead
 * would invoice bread nobody carried on a day the van broke down.
 *
 * The tax is worked out here and STORED, never re-derived on read. A GST return
 * is filed from the invoice, and a rate corrected on a master next year must not
 * silently restate a bill that has already been filed.
 */
@Injectable()
export class SalesInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NUMBERING) private readonly numbering: NumberingPort,
  ) {}

  /**
   * Raise an invoice for a delivery note.
   *
   * Everything billed comes from the NOTE — its lines, quantities, rates and the
   * HSN rates captured when the goods moved. Nothing is re-priced: the customer
   * is charged for what was handed over, at what it was handed over at.
   *
   * One invoice per note, enforced by a unique column rather than a check, so two
   * people pressing the button together cannot both succeed.
   */
  async createFromDeliveryNote(
    userId: number,
    companyId: number | undefined,
    dto: CreateSalesInvoiceDto,
  ) {
    if (!companyId) throw new BadRequestException('No active company.');

    const note = await this.prisma.stockTransaction.findFirst({
      where: { id: dto.deliveryNoteId, companyId, type: 'SALE' },
      select: {
        id: true,
        docNo: true,
        docDate: true,
        branchId: true,
        customerId: true,
      },
    });
    if (!note) {
      throw new BadRequestException(
        'That delivery note does not belong to this company.',
      );
    }
    const existing = await this.prisma.salesInvoice.findUnique({
      where: { deliveryNoteId: note.id },
      select: { invoiceNo: true },
    });
    if (existing) {
      throw new BadRequestException(
        `Delivery note ${note.docNo} is already billed on invoice ${existing.invoiceNo}.`,
      );
    }

    const customerId = dto.customerId ?? note.customerId;
    if (!customerId) {
      throw new BadRequestException(
        'That delivery note names no customer, so there is nobody to bill.',
      );
    }

    const [company, customer, ledger] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true, gstin: true, state: true },
      }),
      this.prisma.customer.findFirst({
        where: { id: customerId, companyId },
        select: {
          id: true,
          name: true,
          gstNumber: true,
          address: true,
          state: true,
          stateCode: true,
        },
      }),
      this.prisma.stockLedger.findMany({
        where: { transactionType: 'SALE', documentId: note.id },
        orderBy: { id: 'asc' },
      }),
    ]);
    if (!company) throw new BadRequestException('No such company.');
    if (!customer) {
      throw new BadRequestException(
        'That customer does not belong to this company.',
      );
    }
    if (!ledger.length) {
      throw new BadRequestException('That delivery note has no lines.');
    }

    const supplierCode = gstStateCode(company.gstin, company.state);
    const placeOfSupplyCode =
      dto.placeOfSupplyCode ??
      gstStateCode(customer.gstNumber, customer.state) ??
      customer.stateCode;
    if (!placeOfSupplyCode) {
      throw new BadRequestException(
        `No place of supply for ${customer.name}. Set the customer's state, or their GSTIN, before billing them.`,
      );
    }
    if (!supplierCode) {
      throw new BadRequestException(
        `${company.name} has no GSTIN or state, so which tax heads apply cannot be decided.`,
      );
    }
    // The one decision the whole bill turns on. Made ONCE, on the invoice: it is
    // a fact about the transaction, not about any line.
    const isInterState = supplierCode !== placeOfSupplyCode;
    const supplyType: GstSupplyType =
      dto.supplyType ?? (customer.gstNumber ? 'B2B' : 'B2C');

    const productIds = [
      ...new Set(ledger.map((l) => l.productId).filter((p): p is number => p != null)),
    ];
    const [products, units] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, hsnCode: { select: { code: true } } },
      }),
      this.prisma.unit.findMany({
        select: { id: true, symbol: true, code: true },
      }),
    ]);
    const product = new Map(products.map((p) => [p.id, p]));
    const unit = new Map(units.map((u) => [u.id, u.symbol ?? u.code]));

    const lines = ledger
      .filter((l) => l.productId != null && l.qtyOut > 0)
      .map((l, sequence) => {
        const taxableValue = paisa(l.qtyOut * l.unitPrice);
        // The rates captured when the goods MOVED, re-apportioned to the heads
        // this bill actually carries. The note may have been entered before
        // anybody knew where it was going; the invoice is where that is settled.
        const total = l.cgst + l.sgst + l.igst;
        const cgstRate = isInterState ? 0 : total / 2;
        const sgstRate = isInterState ? 0 : total / 2;
        const igstRate = isInterState ? total : 0;
        return {
          sequence,
          productId: l.productId!,
          description: product.get(l.productId!)?.name ?? `#${l.productId}`,
          hsnCode: product.get(l.productId!)?.hsnCode?.code ?? null,
          quantity: l.qtyOut,
          unitId: l.unitId,
          unitSymbol: unit.get(l.unitId) ?? null,
          rate: l.unitPrice,
          discount: 0,
          taxableValue,
          cgstRate,
          cgstAmount: paisa((taxableValue * cgstRate) / 100),
          sgstRate,
          sgstAmount: paisa((taxableValue * sgstRate) / 100),
          igstRate,
          igstAmount: paisa((taxableValue * igstRate) / 100),
          cessRate: l.cess,
          cessAmount: paisa((taxableValue * l.cess) / 100),
          lineTotal: 0, // filled below, once the heads are known
        };
      });
    if (!lines.length) {
      throw new BadRequestException(
        'That delivery note moved nothing out, so there is nothing to bill.',
      );
    }
    for (const l of lines) {
      l.lineTotal = paisa(
        l.taxableValue + l.cgstAmount + l.sgstAmount + l.igstAmount + l.cessAmount,
      );
    }

    const taxableValue = paisa(lines.reduce((s, l) => s + l.taxableValue, 0));
    const cgstAmount = paisa(lines.reduce((s, l) => s + l.cgstAmount, 0));
    const sgstAmount = paisa(lines.reduce((s, l) => s + l.sgstAmount, 0));
    const igstAmount = paisa(lines.reduce((s, l) => s + l.igstAmount, 0));
    const cessAmount = paisa(lines.reduce((s, l) => s + l.cessAmount, 0));
    const beforeRounding = paisa(
      taxableValue + cgstAmount + sgstAmount + igstAmount + cessAmount,
    );
    // Rounded to the rupee, and the difference KEPT — so the bill foots to what
    // it says rather than to within a paisa of it.
    const grandTotal = Math.round(beforeRounding);
    const roundOff = paisa(grandTotal - beforeRounding);

    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : note.docDate;
    const finYear = this.finYearOf(invoiceDate);

    // e-invoicing applies to B2B supplies. B2C bills are not registered with the
    // IRP at all, which is why "not required" is a status rather than a blank.
    const einvoiceStatus =
      supplyType === 'B2C' ? 'NOT_REQUIRED' : ('PENDING' as const);

    for (let attempt = 0; ; attempt++) {
      const invoiceNo = await this.numbering.nextOrDefault(
        { companyId, branchId: note.branchId ?? null },
        INVOICE_DOCUMENT_CODE,
        { prefix: 'INV-', padding: 5 },
        invoiceDate,
        attempt,
      );
      try {
        const row = await this.prisma.salesInvoice.create({
          data: {
            companyId,
            branchId: note.branchId,
            invoiceNo,
            finYear,
            invoiceDate,
            customerId: customer.id,
            customerName: customer.name,
            customerGstin: customer.gstNumber,
            customerAddress: customer.address,
            deliveryNoteId: note.id,
            deliveryNoteNo: note.docNo,
            contractId: dto.contractId ?? null,
            contractNo: dto.contractNo ?? null,
            supplyType,
            placeOfSupplyCode,
            placeOfSupply: gstStateName(placeOfSupplyCode) ?? customer.state ?? null,
            isInterState,
            reverseCharge: dto.reverseCharge ?? false,
            taxableValue,
            cgstAmount,
            sgstAmount,
            igstAmount,
            cessAmount,
            roundOff,
            grandTotal,
            einvoiceStatus,
            notes: dto.notes?.trim() || null,
            createdByUserId: userId,
            lines: { create: lines },
          },
          include: withLines,
        });
        return this.view(row);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          attempt < 25
        ) {
          continue; // somebody took that number between our read and our write
        }
        throw e;
      }
    }
  }

  async findAll(companyId: number | undefined, customerId?: number) {
    if (!companyId) return [];
    const rows = await this.prisma.salesInvoice.findMany({
      where: { companyId, ...(customerId ? { customerId } : {}) },
      include: withLines,
      orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.view(r));
  }

  async findOne(companyId: number | undefined, id: number) {
    return this.view(await this.ensure(companyId, id));
  }

  /** Only the parts of a DRAFT that are ours to change. */
  async update(
    companyId: number | undefined,
    id: number,
    dto: UpdateSalesInvoiceDto,
  ) {
    const invoice = await this.ensure(companyId, id);
    assertUnlocked(invoice, 'invoice', 'editing');
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(
        'An issued invoice cannot be edited. Cancel it and raise another.',
      );
    }
    const row = await this.prisma.salesInvoice.update({
      where: { id },
      data: {
        ...(dto.invoiceDate ? { invoiceDate: new Date(dto.invoiceDate) } : {}),
        ...(dto.reverseCharge !== undefined
          ? { reverseCharge: dto.reverseCharge }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
      },
      include: withLines,
    });
    return this.view(row);
  }

  /**
   * Issue the bill. From here it is what the customer owes and what the return
   * reports, so nothing on it changes again.
   */
  async issue(companyId: number | undefined, id: number) {
    const invoice = await this.ensure(companyId, id);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('This invoice has already been issued.');
    }
    const row = await this.prisma.salesInvoice.update({
      where: { id },
      data: { status: 'ISSUED' },
      include: withLines,
    });
    return this.view(row);
  }

  /**
   * Cancel an invoice. Never deleted: a cancelled invoice number is still a
   * number that was issued, and a GST series with a hole in it is a series
   * somebody has to explain.
   */
  async cancel(companyId: number | undefined, id: number, reason?: string) {
    const invoice = await this.ensure(companyId, id);
    assertUnlocked(invoice, 'invoice', 'editing');
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('This invoice is already cancelled.');
    }
    if (invoice.irn) {
      throw new BadRequestException(
        'This invoice is registered with the IRP. Cancel the e-invoice there first — within 24 hours of registration — then cancel it here.',
      );
    }
    const row = await this.prisma.salesInvoice.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: reason?.trim()
          ? `${invoice.notes ? `${invoice.notes}\n` : ''}Cancelled: ${reason.trim()}`
          : invoice.notes,
      },
      include: withLines,
    });
    return this.view(row);
  }

  /**
   * Record what the Invoice Registration Portal returned.
   *
   * Entered by hand today. The shape is the IRP's own — IRN, acknowledgement
   * number and date, and the signed QR — so when the upload is wired the only
   * thing that changes is who calls this, not what it stores.
   */
  async setEInvoice(companyId: number | undefined, id: number, dto: EInvoiceDto) {
    const invoice = await this.ensure(companyId, id);
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException(
        'This invoice is cancelled; it cannot be registered.',
      );
    }
    const row = await this.prisma.salesInvoice.update({
      where: { id },
      data: {
        irn: dto.irn?.trim() || null,
        ackNo: dto.ackNo?.trim() || null,
        ackDate: dto.ackDate ? new Date(dto.ackDate) : null,
        signedQrCode: dto.signedQrCode?.trim() || null,
        einvoiceStatus: dto.status ?? (dto.irn ? 'REGISTERED' : 'PENDING'),
        einvoiceError: dto.error?.trim() || null,
        einvoiceCancelledAt:
          dto.status === 'CANCELLED' ? new Date() : null,
      },
      include: withLines,
    });
    return this.view(row);
  }

  /** Record the e-way bill the portal issued for this consignment. */
  async setEwayBill(companyId: number | undefined, id: number, dto: EwayBillDto) {
    await this.ensure(companyId, id);
    const row = await this.prisma.salesInvoice.update({
      where: { id },
      data: {
        ewbNo: dto.ewbNo?.trim() || null,
        ewbDate: dto.ewbDate ? new Date(dto.ewbDate) : null,
        ewbValidUntil: dto.ewbValidUntil ? new Date(dto.ewbValidUntil) : null,
        distanceKm: dto.distanceKm ?? null,
        transportMode: dto.transportMode?.trim() || null,
        transporterId: dto.transporterId?.trim() || null,
        transporterName: dto.transporterName?.trim() || null,
        vehicleNo: dto.vehicleNo?.trim() || null,
      },
      include: withLines,
    });
    return this.view(row);
  }

  /**
   * Delivery notes with no invoice yet — what the billing screen offers.
   *
   * Only notes naming a CUSTOMER: an intercompany shipment is billed through
   * the dispatch, not here.
   */
  async unbilledDeliveryNotes(companyId: number | undefined, branchId?: number) {
    if (!companyId) return [];
    const billed = await this.prisma.salesInvoice.findMany({
      where: { companyId, deliveryNoteId: { not: null } },
      select: { deliveryNoteId: true },
    });
    const notes = await this.prisma.stockTransaction.findMany({
      where: {
        companyId,
        type: 'SALE',
        customerId: { not: null },
        ...(branchId ? { branchId } : {}),
        id: { notIn: billed.map((b) => b.deliveryNoteId!) },
      },
      select: {
        id: true,
        docNo: true,
        docDate: true,
        branchId: true,
        customerId: true,
      },
      orderBy: { docDate: 'desc' },
      take: 200,
    });
    if (!notes.length) return [];

    const customers = await this.prisma.customer.findMany({
      where: {
        id: {
          in: [...new Set(notes.map((n) => n.customerId!).filter(Boolean))],
        },
      },
      select: { id: true, name: true },
    });
    const name = new Map(customers.map((c) => [c.id, c.name]));
    return notes.map((n) => ({
      id: n.id,
      docNo: n.docNo,
      docDate: n.docDate,
      branchId: n.branchId,
      customerId: n.customerId,
      customerName: n.customerId != null ? (name.get(n.customerId) ?? null) : null,
    }));
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private async ensure(companyId: number | undefined, id: number) {
    if (!companyId) throw new BadRequestException('No active company.');
    const row = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId },
      include: withLines,
    });
    if (!row) throw new NotFoundException('Invoice not found.');
    return row;
  }

  /**
   * The Indian financial year a date falls in, as "2026-27". April to March —
   * and the reason the invoice series is unique per year rather than for ever.
   */
  private finYearOf(date: Date): string {
    const y = date.getUTCFullYear();
    const startYear = date.getUTCMonth() >= 3 ? y : y - 1; // month 3 = April
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  }

  private view(row: Prisma.SalesInvoiceGetPayload<{ include: typeof withLines }>) {
    return {
      ...row,
      invoiceDate: row.invoiceDate.toISOString(),
      totalTax: paisa(
        row.cgstAmount + row.sgstAmount + row.igstAmount + row.cessAmount,
      ),
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAssetBookingDto,
  UpdateAssetBookingDto,
} from './asset-booking.dto';

/**
 * Production-line bookings for assets. A booking reserves a machine over a time
 * slot on a day; only machines flagged `isProductionLine` can be booked, and two
 * live (non-cancelled) bookings on the same machine+day may not overlap. These
 * are written from the Production module when planning production.
 */
@Injectable()
export class AssetBookingService {
  constructor(private prisma: PrismaService) {}

  /** Bookings for one asset, earliest slot first. */
  findForAsset(assetId: number) {
    return this.prisma.assetBooking.findMany({
      where: { assetId },
      orderBy: [{ date: 'asc' }, { timeFrom: 'asc' }],
    });
  }

  async create(dto: CreateAssetBookingDto) {
    await this.assertBookableAsset(dto.assetId);
    const date = this.parseDate(dto.date);
    this.assertTimeOrder(dto.timeFrom, dto.timeTo);
    await this.assertNoOverlap(dto.assetId, date, dto.timeFrom, dto.timeTo);

    return this.prisma.assetBooking.create({
      data: {
        assetId: dto.assetId,
        productId: dto.productId ?? null,
        productName: dto.productName.trim(),
        batchNo: dto.batchNo?.trim() || null,
        date,
        timeFrom: dto.timeFrom,
        timeTo: dto.timeTo,
        status: dto.status ?? 'PLANNED',
      },
    });
  }

  async update(id: number, dto: UpdateAssetBookingDto) {
    const existing = await this.ensureBooking(id);

    // Resolve the effective slot from the patch + current row, then re-validate.
    const date =
      dto.date !== undefined ? this.parseDate(dto.date) : existing.date;
    const timeFrom = dto.timeFrom ?? existing.timeFrom;
    const timeTo = dto.timeTo ?? existing.timeTo;
    this.assertTimeOrder(timeFrom, timeTo);
    await this.assertNoOverlap(existing.assetId, date, timeFrom, timeTo, id);

    return this.prisma.assetBooking.update({
      where: { id },
      data: {
        productId: dto.productId,
        productName: dto.productName?.trim(),
        batchNo:
          dto.batchNo !== undefined ? dto.batchNo?.trim() || null : undefined,
        date: dto.date !== undefined ? date : undefined,
        timeFrom: dto.timeFrom,
        timeTo: dto.timeTo,
        status: dto.status,
      },
    });
  }

  async remove(id: number) {
    await this.ensureBooking(id);
    await this.prisma.assetBooking.delete({ where: { id } });
    return { success: true };
  }

  // --- helpers ---

  private async ensureBooking(id: number) {
    const booking = await this.prisma.assetBooking.findUnique({
      where: { id },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** The asset must exist and be flagged as a production-line machine. */
  private async assertBookableAsset(assetId: number) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, isProductionLine: true },
    });
    if (!asset) throw new BadRequestException('Asset not found.');
    if (!asset.isProductionLine) {
      throw new BadRequestException(
        'This asset is not marked as a production-line machine, so it cannot be booked.',
      );
    }
  }

  private parseDate(value: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid booking date.');
    }
    // Normalise to the day (UTC midnight) so same-day overlap checks line up.
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  private assertTimeOrder(from: string, to: string) {
    if (from >= to) {
      throw new BadRequestException('Time From must be earlier than Time To.');
    }
  }

  /**
   * No two live (non-cancelled) bookings on the same machine+day may overlap.
   * Slots [from,to) overlap when from < otherTo && otherFrom < to. Lexicographic
   * comparison of "HH:mm" strings matches chronological order.
   */
  private async assertNoOverlap(
    assetId: number,
    date: Date,
    from: string,
    to: string,
    excludeId?: number,
  ) {
    const clash = await this.prisma.assetBooking.findFirst({
      where: {
        assetId,
        date,
        status: { not: 'CANCELLED' },
        id: excludeId ? { not: excludeId } : undefined,
        timeFrom: { lt: to },
        timeTo: { gt: from },
      } satisfies Prisma.AssetBookingWhereInput,
      select: { id: true, timeFrom: true, timeTo: true },
    });
    if (clash) {
      throw new BadRequestException(
        `This slot overlaps an existing booking (${clash.timeFrom}–${clash.timeTo}) for this machine on the same day.`,
      );
    }
  }
}

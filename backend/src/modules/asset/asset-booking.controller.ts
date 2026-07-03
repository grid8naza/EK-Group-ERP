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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AssetBookingService } from './asset-booking.service';
import {
  CreateAssetBookingDto,
  UpdateAssetBookingDto,
} from './asset-booking.dto';

/**
 * Production-line bookings for assets. Populated from the Production module when
 * planning production; exposed here so an asset's reserved slots can be listed
 * and maintained.
 */
@ApiTags('asset-bookings')
@ApiBearerAuth()
@Controller('asset-bookings')
export class AssetBookingController {
  constructor(private readonly service: AssetBookingService) {}

  @Get()
  findForAsset(@Query('assetId', ParseIntPipe) assetId: number) {
    return this.service.findForAsset(assetId);
  }

  @Post()
  create(@Body() dto: CreateAssetBookingDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssetBookingDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

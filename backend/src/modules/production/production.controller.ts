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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { assertSuperAdmin } from '../../common/assert-super-admin';
import { LockDto } from '../../common/lock.dto';
import { ProductionService } from './production.service';
import {
  CreateProductionOrderDto,
  UpdateProductionOrderDto,
} from './production.dto';

@ApiTags('production')
@ApiBearerAuth()
@Controller('production/orders')
export class ProductionController {
  constructor(private readonly service: ProductionService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(this.requireCompany(companyId), search);
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(this.requireCompany(companyId), id);
  }

  @Post()
  create(
    @CompanyId() companyId: number | undefined,
    @Body() dto: CreateProductionOrderDto,
  ) {
    return this.service.create(this.requireCompany(companyId), dto);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductionOrderDto,
  ) {
    return this.service.update(this.requireCompany(companyId), id, dto);
  }

  @Delete(':id')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(this.requireCompany(companyId), id);
  }

  // Lock / unlock a production order (must be unlocked before edit or delete).
  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSuperAdmin(user);
    return this.service.setLock(this.requireCompany(companyId), id, dto.locked);
  }

  private requireCompany(companyId?: number): number {
    if (!companyId) throw new BadRequestException('No active company selected');
    return companyId;
  }
}

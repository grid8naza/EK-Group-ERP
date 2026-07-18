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
import { ProductionDivisionService } from './production-division.service';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import {
  CreateProductionDivisionDto,
  UpdateProductionDivisionDto,
} from './production-division.dto';

/** Production Division master — org units that produce a family of products. */
@ApiTags('production-divisions')
@ApiBearerAuth()
@Controller('production-divisions')
export class ProductionDivisionController {
  constructor(private readonly service: ProductionDivisionService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(companyId, search);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @CompanyId() companyId: number | undefined,
    @Body() dto: CreateProductionDivisionDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductionDivisionDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @UseGuards(LockPrivilegeGuard('/production/divisions'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}

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
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { AssetCategoryService } from './asset-category.service';
import {
  CreateAssetCategoryDto,
  UpdateAssetCategoryDto,
} from './asset-category.dto';

/**
 * Asset Category Master — top level of the asset classification. A category is
 * available to all companies or a chosen set; the list is filtered to those
 * available in the active company (X-Company-Id).
 */
@ApiTags('asset-categories')
@ApiBearerAuth()
@Controller('asset-categories')
export class AssetCategoryController {
  constructor(private readonly service: AssetCategoryService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(companyId, search);
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  create(@Body() dto: CreateAssetCategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssetCategoryDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(companyId, id);
  }

  // Lock / unlock (super-admin only), like every other master.
  @UseGuards(LockPrivilegeGuard('/asset/asset-categories'))
  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}

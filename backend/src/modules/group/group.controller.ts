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
import { CategoryKind } from '@prisma/client';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { GroupService } from './group.service';
import { CreateGroupDto, UpdateGroupDto } from './group.dto';

/**
 * Group Master (Inventory) — ONE shared classification tree that categories
 * draw from, so the same sub-groups need not be re-entered under each category.
 * Available to all or a chosen set of companies; the list is filtered to those
 * available in the active company, and can be narrowed to a single category or
 * to one category KIND (how the item/product screens scope themselves).
 */
@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupController {
  constructor(private readonly service: GroupService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('kind') kind?: CategoryKind,
    @Query('primaryGroupId') primaryGroupId?: string,
    @Query('parentGroupId') parentGroupId?: string,
  ) {
    // Optional numeric query params: parse with Number() (a missing value must
    // not 400 — see the query-int-parsing convention).
    const toId = (v?: string) => {
      const n = Number(v);
      return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
    };
    return this.service.findAll(companyId, {
      search,
      categoryId: toId(categoryId),
      kind,
      primaryGroupId: toId(primaryGroupId),
      parentGroupId: toId(parentGroupId),
    });
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  create(@Body() dto: CreateGroupDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupDto,
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

  @UseGuards(LockPrivilegeGuard('/inventory/groups'))
  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}

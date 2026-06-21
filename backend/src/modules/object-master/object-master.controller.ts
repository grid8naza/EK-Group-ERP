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
import { ObjectType } from '@prisma/client';
import { ObjectMasterService } from './object-master.service';
import { CompanyId } from '../../auth/company.decorator';
import {
  CreateObjectDto,
  CreateObjectRevisionDto,
  UpdateObjectDto,
} from './object-master.dto';

function requireCompany(companyId?: number): number {
  if (!companyId) throw new BadRequestException('No active company selected');
  return companyId;
}

@ApiTags('objects')
@ApiBearerAuth()
@Controller('objects')
export class ObjectMasterController {
  constructor(private readonly service: ObjectMasterService) {}

  @Get()
  findAll(
    @CompanyId() companyId?: number,
    @Query('search') search?: string,
    @Query('moduleId') moduleId?: string,
    @Query('objectType') objectType?: ObjectType,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findAll({
      companyId: requireCompany(companyId),
      search,
      moduleId: moduleId ? Number(moduleId) : undefined,
      objectType,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateObjectDto, @CompanyId() companyId?: number) {
    return this.service.create(dto, requireCompany(companyId));
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateObjectDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Get(':id/revisions')
  findRevisions(@Param('id', ParseIntPipe) id: number) {
    return this.service.findRevisions(id);
  }

  @Post(':id/revisions')
  createRevision(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateObjectRevisionDto,
  ) {
    return this.service.createRevision(id, dto);
  }
}

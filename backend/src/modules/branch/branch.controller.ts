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
import { BranchService } from './branch.service';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { LockDto } from '../../common/lock.dto';
import { CreateBranchDto, UpdateBranchDto } from './branch.dto';

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchController {
  constructor(private readonly service: BranchService) {}

  @Get()
  findAll(@Query('companyId') companyId?: string) {
    return this.service.findAll(companyId ? Number(companyId) : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBranchDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock (super-admin only), like every other master.
  @UseGuards(SuperAdminGuard)
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}

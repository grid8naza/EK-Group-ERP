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
import { GadgetService } from './gadget.service';
import { CompanyId } from '../../auth/company.decorator';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { assertSuperAdmin } from '../../common/assert-super-admin';
import { LockDto } from '../../common/lock.dto';
import { CreateGadgetDto, UpdateGadgetDto } from './gadget.dto';

function requireCompany(companyId?: number): number {
  if (!companyId) throw new BadRequestException('No active company selected');
  return companyId;
}

@ApiTags('gadgets')
@ApiBearerAuth()
@Controller('gadgets')
export class GadgetController {
  constructor(private readonly service: GadgetService) {}

  @Get()
  findAll(@CompanyId() companyId?: number, @Query('moduleId') moduleId?: string) {
    return this.service.findAll(
      requireCompany(companyId),
      moduleId ? Number(moduleId) : undefined,
    );
  }

  @Post()
  create(@Body() dto: CreateGadgetDto, @CompanyId() companyId?: number) {
    return this.service.create(dto, requireCompany(companyId));
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGadgetDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a gadget (must be unlocked before edit or delete).
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSuperAdmin(user);
    return this.service.setLock(id, dto.locked);
  }
}

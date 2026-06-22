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
import { MenuService } from './menu.service';
import { CompanyId } from '../../auth/company.decorator';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { assertSuperAdmin } from '../../common/assert-super-admin';
import { LockDto } from '../../common/lock.dto';
import {
  CreateMainMenuDto,
  CreateSubMenuDto,
  ReorderDto,
  UpdateMainMenuDto,
  UpdateSubMenuDto,
} from './menu.dto';

function requireCompany(companyId?: number): number {
  if (!companyId) throw new BadRequestException('No active company selected');
  return companyId;
}

@ApiTags('main-menus')
@ApiBearerAuth()
@Controller('main-menus')
export class MainMenuController {
  constructor(private readonly service: MenuService) {}

  @Get()
  findAll(@CompanyId() companyId?: number, @Query('moduleId') moduleId?: string) {
    return this.service.findAllMainMenus(
      requireCompany(companyId),
      moduleId ? Number(moduleId) : undefined,
    );
  }

  // Persist a drag-reordered list. Declared before ':id' so it is matched.
  @Post('reorder')
  reorder(@Body() dto: ReorderDto) {
    return this.service.reorderMainMenus(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOneMainMenu(id);
  }

  @Post()
  create(@Body() dto: CreateMainMenuDto, @CompanyId() companyId?: number) {
    return this.service.createMainMenu(dto, requireCompany(companyId));
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMainMenuDto,
  ) {
    return this.service.updateMainMenu(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeMainMenu(id);
  }

  // Lock / unlock a main menu (must be unlocked before edit or delete).
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSuperAdmin(user);
    return this.service.setLockMainMenu(id, dto.locked);
  }
}

@ApiTags('sub-menus')
@ApiBearerAuth()
@Controller('sub-menus')
export class SubMenuController {
  constructor(private readonly service: MenuService) {}

  @Get()
  findAll(@Query('mainMenuId') mainMenuId?: string) {
    return this.service.findAllSubMenus(
      mainMenuId ? Number(mainMenuId) : undefined,
    );
  }

  @Post('reorder')
  reorder(@Body() dto: ReorderDto) {
    return this.service.reorderSubMenus(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOneSubMenu(id);
  }

  @Post()
  create(@Body() dto: CreateSubMenuDto) {
    return this.service.createSubMenu(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubMenuDto) {
    return this.service.updateSubMenu(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeSubMenu(id);
  }

  // Lock / unlock a sub-menu (must be unlocked before edit or delete).
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSuperAdmin(user);
    return this.service.setLockSubMenu(id, dto.locked);
  }
}

@ApiTags('menus')
@ApiBearerAuth()
@Controller('menus')
export class MenuController {
  constructor(private readonly service: MenuService) {}

  @Get('tree')
  tree(@CompanyId() companyId?: number, @Query('moduleId') moduleId?: string) {
    return this.service.tree(
      requireCompany(companyId),
      moduleId ? Number(moduleId) : undefined,
    );
  }
}

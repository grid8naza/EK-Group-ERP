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
import { UserService } from './user.service';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { LockDto } from '../../common/lock.dto';
import { CreateUserDto, UpdateUserDto } from './user.dto';

// Managing users (and their group/company/branch/module access) is a
// super-admin-only operation, matching the Cpanel navigation which only
// surfaces this screen to super admins. Enforced server-side so the endpoints
// can't be reached directly by a non-super-admin who has a valid token.
//
// It stays super-admin-only now that logins are set up from HR → Employee
// Master → User Access: the screen moved, the authority did not. Anything less
// would let whoever maintains staff records hand themselves a role, and the
// User Access tab is read-only for them for the same reason.
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    // Number(), not an optional ParseIntPipe, which 400s on an absent param.
    return this.service.findAll(search, Number(employeeId) || undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a user (must be unlocked before edit or delete).
  @UseGuards(LockPrivilegeGuard('/cpanel/users'))
  @Patch(':id/lock')
  setLock(@Param('id', ParseIntPipe) id: number, @Body() dto: LockDto) {
    return this.service.setLock(id, dto.locked);
  }
}

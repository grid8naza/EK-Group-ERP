import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { TabPrivilegeGuard } from '../../auth/tab-privilege.guard';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import { LockDto } from '../../common/lock.dto';
import { CreateUserDto, UpdateUserDto } from './user.dto';

/**
 * Logins are set up from HR → Employee Master → User Access, so who may reach
 * these endpoints is decided by who may see THAT TAB — the tick in Cpanel →
 * User Groups & Privileges, per group. Super admins always pass.
 *
 * Enforced here as well as in the page, so a valid token cannot be pointed
 * straight at the endpoint by somebody whose group has the tab hidden.
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(
  TabPrivilegeGuard(
    '/hr/employees',
    'access',
    'You do not have permission to set up logins. Ask an administrator for the User Access tab on Employee Master.',
  ),
)
@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get()
  findAll(
    @CurrentUser() me: AuthUser,
    @Query('search') search?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    // Number(), not an optional ParseIntPipe, which 400s on an absent param.
    const forEmployee = Number(employeeId) || undefined;
    // The whole register is the Cpanel screen's, and that is super admins'
    // alone. Somebody working from the employee's own record is asking about
    // ONE person, so that is all they may ask for — otherwise the tab would
    // double as a way to enumerate every login in the group.
    if (!me.isSuperAdmin && !forEmployee) {
      throw new ForbiddenException(
        'Ask for one employee’s login (employeeId), not the whole register.',
      );
    }
    return this.service.findAll(search, forEmployee);
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

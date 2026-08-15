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
import { TabPrivilegeGuard } from '../../auth/tab-privilege.guard';
import { HrSalaryService } from './hr-salary.service';
import { SaveSalaryPackageDto } from './hr-salary.dto';

/**
 * Salary packages, under the employee they belong to.
 *
 * Guarded by the SALARY TAB of Employee Master — the same tick that decides
 * whether the tab is on screen decides whether these endpoints answer, so a
 * group that cannot see what people earn cannot fetch it either.
 */
@ApiTags('hr-employees')
@ApiBearerAuth()
@UseGuards(
  TabPrivilegeGuard(
    '/hr/employees',
    'salary',
    'You do not have permission to see salary details. Ask an administrator for the Salary tab on Employee Master.',
  ),
)
@Controller('hr-employees/:employeeId/salary-packages')
export class HrSalaryController {
  constructor(private readonly service: HrSalaryService) {}

  @Get()
  findAll(@Param('employeeId', ParseIntPipe) employeeId: number) {
    return this.service.findAll(employeeId);
  }

  /**
   * The package in force on a date — what a payroll run asks for, and what
   * makes "payroll checks the effective date" answerable today rather than
   * whenever that module is built.
   *
   * Declared BEFORE the :packageId routes: Nest matches in order, and
   * "effective" would otherwise be read as an id and 400 on the pipe.
   */
  @Get('effective')
  async effective(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query('on') on?: string,
  ) {
    // Defaults to today, which is what somebody asking without a date means.
    const date = on || new Date().toISOString().slice(0, 10);
    // Wrapped rather than returned bare, because "no package that day" is a
    // real answer and Nest sends a bare null as an EMPTY BODY — which is not
    // JSON, and breaks a caller that parses the response. `on` comes back too,
    // so a payroll run can log which date it actually resolved.
    return {
      on: date,
      package: await this.service.packageOn(employeeId, date),
    };
  }

  @Post()
  async create(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: SaveSalaryPackageDto,
  ) {
    await this.service.create(employeeId, dto);
    // The whole series comes back: raising an increment closes the package
    // before it, so more than the new row has changed.
    return this.service.findAll(employeeId);
  }

  @Patch(':packageId')
  async update(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Param('packageId', ParseIntPipe) packageId: number,
    @Body() dto: SaveSalaryPackageDto,
  ) {
    await this.service.update(employeeId, packageId, dto);
    return this.service.findAll(employeeId);
  }

  @Delete(':packageId')
  async remove(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Param('packageId', ParseIntPipe) packageId: number,
  ) {
    await this.service.remove(employeeId, packageId);
    return this.service.findAll(employeeId);
  }
}

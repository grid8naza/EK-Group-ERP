import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { TabPrivilegeGuard } from '../../auth/tab-privilege.guard';
import { HrRegisterService } from './hr-register.service';

/**
 * Company-wide registers — the cross-employee reads the HR reports are built
 * on, as opposed to the per-employee series behind the tabs.
 *
 * Split into two controllers because they are not equally sensitive. The
 * postings register is ordinary staff information; the salary register is
 * everybody's pay on one page, so it carries the same guard as the Salary tab —
 * a group that may not see one person's package has no business with the lot.
 */
@ApiTags('hr-reports')
@ApiBearerAuth()
@Controller('hr-registers/postings')
export class HrPostingRegisterController {
  constructor(private readonly service: HrRegisterService) {}

  /**
   * Every posting that was in force at any point in the window — the promotions
   * and transfers of a period, across the whole company.
   *
   * Defaults to the current year, which is what "the register" means to
   * somebody who has not said otherwise.
   */
  @Get()
  postings(
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.postingRegister(companyId, branchId, from, to);
  }
}

@ApiTags('hr-reports')
@ApiBearerAuth()
@UseGuards(
  TabPrivilegeGuard(
    '/hr/employees',
    'salary',
    'You do not have permission to see salary details.',
  ),
)
@Controller('hr-registers/salary')
export class HrSalaryRegisterController {
  constructor(private readonly service: HrRegisterService) {}

  /**
   * What every employee was on, on one day.
   *
   * A date rather than "now", because the question a payroll clerk asks is
   * always about a month that may already have closed. Defaults to today.
   */
  @Get()
  salary(
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
    @Query('on') on?: string,
  ) {
    return this.service.salaryRegister(companyId, branchId, on);
  }
}

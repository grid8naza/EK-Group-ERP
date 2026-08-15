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
import { HrPostingService } from './hr-posting.service';
import { SavePostingDto } from './hr-posting.dto';

/**
 * The service record — where an employee has worked and as what.
 *
 * Guarded by the POSTINGS tab of Employee Master, so the tick that decides
 * whether the tab is on screen decides whether these endpoints answer.
 */
@ApiTags('hr-employees')
@ApiBearerAuth()
@UseGuards(
  TabPrivilegeGuard(
    '/hr/employees',
    'postings',
    'You do not have permission to see postings. Ask an administrator for the Postings tab on Employee Master.',
  ),
)
@Controller('hr-employees/:employeeId/postings')
export class HrPostingController {
  constructor(private readonly service: HrPostingService) {}

  @Get()
  findAll(@Param('employeeId', ParseIntPipe) employeeId: number) {
    return this.service.findAll(employeeId);
  }

  /**
   * Where they were on a date. Declared BEFORE the :postingId routes — Nest
   * matches in order, and "effective" would otherwise be read as an id.
   */
  @Get('effective')
  async effective(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query('on') on?: string,
  ) {
    const date = on || new Date().toISOString().slice(0, 10);
    // Wrapped for the same reason the salary lookup is: "nowhere on that day"
    // is a real answer, and a bare null reaches the caller as an empty body.
    return {
      on: date,
      posting: await this.service.postingOn(employeeId, date),
    };
  }

  // Each write returns the whole series: a transfer closes the posting before
  // it, so more than the new row has changed.
  @Post()
  create(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: SavePostingDto,
  ) {
    return this.service.create(employeeId, dto);
  }

  @Patch(':postingId')
  update(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Param('postingId', ParseIntPipe) postingId: number,
    @Body() dto: SavePostingDto,
  ) {
    return this.service.update(employeeId, postingId, dto);
  }

  @Delete(':postingId')
  remove(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Param('postingId', ParseIntPipe) postingId: number,
  ) {
    return this.service.remove(employeeId, postingId);
  }
}

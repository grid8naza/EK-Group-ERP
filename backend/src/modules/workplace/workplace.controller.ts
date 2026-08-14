import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { WorkplaceService } from './workplace.service';

/**
 * The Workplace dashboard.
 *
 * One route, and it takes no company: this dashboard belongs to the person, not
 * to the company they are working in, so X-Company-Id is deliberately ignored
 * here. Everything is derived from the authenticated user.
 */
@ApiTags('workplace')
@ApiBearerAuth()
@Controller('workplace')
export class WorkplaceController {
  constructor(private readonly service: WorkplaceService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.service.dashboard(user.id);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../auth/current-user.decorator';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { CircularService, UploadedCircularFile } from './circular.service';
import {
  CIRCULAR_MAX_FILE_BYTES,
  CIRCULAR_UPLOAD_DIR,
} from './circular.constants';
import {
  AcknowledgeCircularDto,
  IssueCircularDto,
  PreviewAudienceDto,
} from './circular.dto';

/**
 * Circulars (SRS §8.11, FR-COM-04).
 *
 * Every route is scoped to the authenticated user — a circular is reachable
 * because you issued it or were issued it, never because of the company you
 * happen to be working in — so no route takes a user id, and X-Company-Id /
 * X-Branch-Id are read only to stamp where one was issued from.
 */
@ApiTags('circulars')
@ApiBearerAuth()
@Controller('circulars')
export class CircularController {
  constructor(private readonly service: CircularService) {}

  // -------------------------------------------------------------- audience --

  /** The companies, branches and role groups this person may issue to. */
  @Get('audience')
  audience(@CurrentUser() user: AuthUser) {
    return this.service.audienceOptions(user.id);
  }

  /** Everybody they can name individually, on top of those. */
  @Get('directory')
  directory(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.service.directory(user.id, q);
  }

  /** How many people a chosen audience comes to, before issuing to it. */
  @Post('audience/preview')
  preview(@CurrentUser() user: AuthUser, @Body() dto: PreviewAudienceDto) {
    return this.service.preview(user.id, dto.audience);
  }

  // ----------------------------------------------------------------- lists --

  /** Circulars this person has issued. `archived=1` for the withdrawn ones. */
  @Get('issued')
  issued(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('archived') archived?: string,
    @Query('page') page?: string,
  ) {
    return this.service.issued(user.id, {
      q,
      archived: archived === '1' || archived === 'true',
      // Number(), not ParseIntPipe({optional:true}) — that 400s on an absent param.
      page: Number(page) || undefined,
    });
  }

  /** Circulars issued to this person. `pending=1` for the unacknowledged. */
  @Get('received')
  received(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('pending') pending?: string,
    @Query('archived') archived?: string,
    @Query('page') page?: string,
  ) {
    return this.service.received(user.id, {
      q,
      pendingOnly: pending === '1' || pending === 'true',
      archived: archived === '1' || archived === 'true',
      page: Number(page) || undefined,
    });
  }

  /** Awaiting this person's acknowledgement, for the badge. */
  @Get('pending-count')
  pendingCount(@CurrentUser() user: AuthUser) {
    return this.service.pendingCount(user.id);
  }

  // ------------------------------------------------------------ one notice --

  /** Declared before `:id` so the literal path is not eaten by the parameter. */
  @Post()
  issue(
    @CurrentUser() user: AuthUser,
    @Body() dto: IssueCircularDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.issue(user.id, dto, companyId, branchId);
  }

  /** Opening it as a recipient is what marks it read. */
  @Get(':id')
  open(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user.id, id);
  }

  @Post(':id/acknowledge')
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcknowledgeCircularDto,
  ) {
    return this.service.acknowledge(user.id, id, dto.note);
  }

  /** The issuer withdraws it to the archive. Nothing is destroyed. */
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.setArchived(user.id, id, true);
  }

  @Post(':id/unarchive')
  unarchive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.setArchived(user.id, id, false);
  }

  // --------------------------------------------------------- the attachments --

  /**
   * Upload one file, ahead of the circular that carries it. The response is
   * handed straight back in the issue body's `attachments`.
   */
  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: CIRCULAR_UPLOAD_DIR,
      limits: { fileSize: CIRCULAR_MAX_FILE_BYTES },
    }),
  )
  upload(@UploadedFile() file: UploadedCircularFile) {
    return this.service.saveAttachment(file);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DocumentNumberingService } from './document-numbering.service';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { SaveNumberingRuleDto } from './document-numbering.dto';

/** Document Numbering (Cpanel) — per-company sequencer rules for each document. */
@ApiTags('document-numbering')
@ApiBearerAuth()
@Controller('document-numbering')
export class DocumentNumberingController {
  constructor(private readonly service: DocumentNumberingService) {}

  @Get()
  overview(@CompanyId() companyId: number | undefined) {
    return this.service.overview(companyId);
  }

  @Put()
  save(
    @CompanyId() companyId: number | undefined,
    @Body() dto: SaveNumberingRuleDto,
  ) {
    return this.service.save(companyId, dto);
  }

  @Delete(':documentId')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.service.remove(companyId, documentId);
  }

  @UseGuards(LockPrivilegeGuard('/cpanel/document-numbering'))
  @Patch(':documentId/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, documentId, dto.locked);
  }
}


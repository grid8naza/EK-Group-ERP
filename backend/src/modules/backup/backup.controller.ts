import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as os from 'os';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BackupService } from './backup.service';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { CurrentUser, AuthUser } from '../../auth/current-user.decorator';
import {
  ChangeSecurityPasswordDto,
  CreateBackupDto,
  RestoreBackupDto,
} from './backup.dto';

/** A multer-saved upload (minimal shape; avoids needing @types/multer). */
interface UploadedDump {
  path: string;
  originalname: string;
}

/**
 * Database backup & restore. Super-admin only, and every destructive action
 * additionally requires the "high security password" (a second gate, separate
 * from the login password). See SecuritySetting.
 */
@ApiTags('backup')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('backup')
export class BackupController {
  constructor(private readonly service: BackupService) {}

  // ---- High security password ----------------------------------------------

  @Get('security/status')
  status() {
    return this.service.getStatus();
  }

  // Lets the UI "unlock" the page by checking the password before showing the
  // backup / restore actions. The actual operations re-verify server-side.
  @Post('security/verify')
  async verify(@Body('highSecurityPassword') password: string) {
    await this.service.verifyPassword(password ?? '');
    return { valid: true };
  }

  @Patch('security/password')
  changePassword(@Body() dto: ChangeSecurityPasswordDto) {
    return this.service.changePassword(dto.currentPassword, dto.newPassword);
  }

  // ---- Backups -------------------------------------------------------------

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateBackupDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto.highSecurityPassword, dto.note, user.name);
  }

  @Post('restore')
  restore(@Body() dto: RestoreBackupDto) {
    return this.service.restoreFromFile(dto.highSecurityPassword, dto.fileName);
  }

  @Post('restore/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      // `dest` makes multer stream the upload to disk (not memory), so large
      // dumps don't blow up the process. file.path points at the temp file.
      dest: os.tmpdir(),
      limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
    }),
  )
  async restoreUpload(
    @UploadedFile() file: UploadedDump,
    @Body('highSecurityPassword') password: string,
  ) {
    if (!file) throw new BadRequestException('No backup file uploaded.');
    if (!password) {
      throw new BadRequestException('High security password is required.');
    }
    return this.service.restoreFromUpload(password, file.path);
  }

  @Get(':name/download')
  @Header('Content-Type', 'application/octet-stream')
  async download(
    @Param('name') name: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { fileName, stream } = await this.service.getFileForDownload(name);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    return new StreamableFile(stream);
  }

  @Delete(':name')
  remove(@Param('name') name: string) {
    return this.service.remove(name);
  }
}

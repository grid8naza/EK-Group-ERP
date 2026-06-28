import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LoginScreenService } from './login-screen.service';
import { SaveLoginScreenDto } from './login-screen.dto';
import { Public } from '../../auth/public.decorator';
import { LOGIN_UPLOAD_DIR } from './login-screen.constants';

/** Minimal multer file shape (avoids needing @types/multer). */
interface MulterFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MEDIA_MIME = [...IMAGE_MIME, 'video/mp4', 'video/webm'];

// multer fileFilter callbacks.
const imageFilter = (
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
) => cb(null, IMAGE_MIME.includes(file.mimetype));
const mediaFilter = (
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
) => cb(null, MEDIA_MIME.includes(file.mimetype));

/**
 * Global login-screen customization (singleton). The login page is shown before
 * any company is selected, so this branding is app-wide. The `public` GET is
 * the only unauthenticated route — the login page fetches it before sign-in.
 */
@ApiTags('login-screen')
@ApiBearerAuth()
@Controller('login-screen')
export class LoginScreenController {
  constructor(private readonly service: LoginScreenService) {}

  @Public()
  @Get('public')
  publicConfig() {
    return this.service.getConfig();
  }

  @Get()
  get() {
    return this.service.getConfig();
  }

  @Put()
  save(@Body() dto: SaveLoginScreenDto) {
    return this.service.saveConfig(dto.config ?? null);
  }

  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: LOGIN_UPLOAD_DIR,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: imageFilter,
    }),
  )
  uploadLogo(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException(
        'No image uploaded (PNG / JPG / WEBP / GIF, max 5 MB).',
      );
    }
    return this.service.addLogo(file);
  }

  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: LOGIN_UPLOAD_DIR,
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
      fileFilter: mediaFilter,
    }),
  )
  uploadMedia(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException(
        'Unsupported or too-large file (image / GIF / video, max 50 MB).',
      );
    }
    return this.service.addMedia(file);
  }

  @Delete('media/:id')
  removeMedia(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeMedia(id);
  }
}

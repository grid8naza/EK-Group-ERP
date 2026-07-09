import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SoftwareInfoService } from './software-info.service';
import { SaveSoftwareInfoDto } from './software-info.dto';
import { Public } from '../../auth/public.decorator';
import { SOFTWARE_UPLOAD_DIR } from './software-info.constants';

/** Minimal multer file shape (avoids needing @types/multer). */
interface MulterFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

const IMAGE_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
];
const imageFilter = (
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
) => cb(null, IMAGE_MIME.includes(file.mimetype));

/**
 * Global software / licence information (singleton). Shown as the app's brand
 * tile. The `public` GET lets the brand render before a company is chosen.
 */
@ApiTags('software-info')
@ApiBearerAuth()
@Controller('software-info')
export class SoftwareInfoController {
  constructor(private readonly service: SoftwareInfoService) {}

  @Public()
  @Get('public')
  publicInfo() {
    return this.service.get();
  }

  @Get()
  get() {
    return this.service.get();
  }

  @Put()
  save(@Body() dto: SaveSoftwareInfoDto) {
    return this.service.save(dto);
  }

  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: SOFTWARE_UPLOAD_DIR,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: imageFilter,
    }),
  )
  uploadLogo(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException(
        'No image uploaded (PNG / JPG / WEBP / GIF / SVG, max 5 MB).',
      );
    }
    return this.service.addLogo(file);
  }
}

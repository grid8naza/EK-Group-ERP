import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyService } from './company.service';
import { CompanyId } from '../../auth/company.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { COMPANY_UPLOAD_DIR } from './company.constants';
import {
  CreateCompanyDto,
  SetCompanyModulesDto,
  UpdateCompanyDto,
} from './company.dto';

interface MulterFile {
  path: string;
  originalname: string;
  mimetype: string;
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

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompanyController {
  constructor(private readonly service: CompanyService) {}

  @Get()
  findAll(@Query('search') search?: string) {
    return this.service.findAll(search);
  }

  // Enabled modules for the *active* company (drives module dropdowns).
  @Get('enabled-modules')
  enabledModules(@CompanyId() companyId?: number) {
    if (!companyId) throw new BadRequestException('No active company selected');
    return this.service.getEnabledModules(companyId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  // Upload a company logo; returns { url } to store in the company's `logo`.
  // Decoupled from a company id so it works before the company is created.
  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: COMPANY_UPLOAD_DIR,
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
    return this.service.uploadLogo(file);
  }

  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCompanyDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // Lock / unlock a company (must be unlocked before edit or delete).
  @UseGuards(LockPrivilegeGuard('/cpanel/companies'))
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(id, dto.locked);
  }

  @Get(':id/modules')
  getModules(@Param('id', ParseIntPipe) id: number) {
    return this.service.getModules(id);
  }

  @Put(':id/modules')
  setModules(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetCompanyModulesDto,
  ) {
    return this.service.setModules(id, dto);
  }
}

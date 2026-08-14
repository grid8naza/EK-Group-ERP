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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId } from '../../auth/company.decorator';
import { BranchId } from '../../auth/branch.decorator';
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { EMPLOYEE_UPLOAD_DIR } from './hr-employee.constants';
import { HrEmployeeService } from './hr-employee.service';
import { SaveEmployeeDto } from './hr-employee.dto';

/** What multer hands the handler. */
interface MulterFile {
  originalname: string;
  mimetype: string;
  path: string;
}

/**
 * A photograph, not a document: the three formats a camera or a phone produces,
 * and nothing that can carry a script. SVG is deliberately absent — it is markup,
 * and this one is displayed back inside the application.
 */
const photoFilter = (
  _req: unknown,
  file: MulterFile,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  cb(null, allowed.includes(file.mimetype));
};

/** Employee Master (SRS §8.9, FR-HRP-01). */
@ApiTags('hr-employees')
@ApiBearerAuth()
@Controller('hr-employees')
export class HrEmployeeController {
  constructor(private readonly service: HrEmployeeService) {}

  /**
   * Upload a photograph; returns { url } to store on the employee.
   *
   * Decoupled from an employee id so it works before the row exists — the same
   * shape as the company logo upload, and the reason the picture can be required
   * on create.
   */
  @Post('photo')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: EMPLOYEE_UPLOAD_DIR,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: photoFilter,
    }),
  )
  uploadPhoto(@UploadedFile() file?: MulterFile) {
    if (!file) {
      throw new BadRequestException(
        'No photograph uploaded (PNG / JPG / WEBP, max 5 MB).',
      );
    }
    return this.service.uploadPhoto(file);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('all') all?: string,
    @CompanyId() companyId?: number,
  ) {
    // Number(), not an optional ParseIntPipe, which 400s on an absent param.
    return this.service.findAll(companyId, {
      search,
      branchId: Number(branchId) || undefined,
      all: all === '1' || all === 'true',
    });
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  create(
    @Body() dto: SaveEmployeeDto,
    @CompanyId() companyId?: number,
    @BranchId() branchId?: number,
  ) {
    return this.service.create(companyId, branchId, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveEmployeeDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CompanyId() companyId?: number,
  ) {
    return this.service.remove(companyId, id);
  }

  // Lock / unlock (must be unlocked before edit or delete).
  @UseGuards(LockPrivilegeGuard('/hr/employees'))
  @Patch(':id/lock')
  setLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
    @CompanyId() companyId?: number,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}

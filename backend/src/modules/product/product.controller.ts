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
import { LockPrivilegeGuard } from '../../auth/lock-privilege.guard';
import { LockDto } from '../../common/lock.dto';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from './product.dto';
import { PRODUCT_UPLOAD_DIR } from './product.constants';

/** Minimal multer file shape (avoids needing @types/multer). */
interface MulterFile {
  path: string;
  originalname: string;
  mimetype: string;
}

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const imageFilter = (
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
) => cb(null, IMAGE_MIME.includes(file.mimetype));

/**
 * Product Master + double BOM. The master data is managed under Inventory; the
 * recipe/packing BOM is edited under Production. Products are available to all
 * companies or a chosen set, filtered to the active company (X-Company-Id).
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductController {
  constructor(private readonly service: ProductService) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(companyId, search);
  }

  @Get(':id')
  findOne(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(companyId, id);
  }

  // Upload a product picture; returns { url } to store in the product's
  // `imageUrl`. Decoupled from a product id so it works before the product is
  // created (sellable products only, enforced in the UI).
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: PRODUCT_UPLOAD_DIR,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: imageFilter,
    }),
  )
  uploadImage(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException(
        'No image uploaded (PNG / JPG / WEBP / GIF, max 5 MB).',
      );
    }
    return this.service.uploadImage(file);
  }

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(companyId, id);
  }

  @UseGuards(LockPrivilegeGuard('/inventory/products'))
  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}

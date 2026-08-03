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
import { CostingService } from './costing.service';
import {
  ApplyCostingDto,
  CreateProductDto,
  RevisePricesDto,
  UpdateProductDto,
} from './product.dto';
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
  constructor(
    private readonly service: ProductService,
    private readonly costing: CostingService,
  ) {}

  @Get()
  findAll(
    @CompanyId() companyId: number | undefined,
    @Query('search') search?: string,
    // Browse another company's catalogue (e.g. a requester picking a supplier's
    // products when placing a CRM order). Falls back to the active company.
    @Query('forCompanyId') forCompanyId?: string,
  ) {
    const scoped = forCompanyId ? Number(forCompanyId) : companyId;
    return this.service.findAll(scoped, search);
  }

  // Declared BEFORE `:id` — otherwise "costing" is parsed as a product id.
  //
  // What each manufactured product's recipe / packing BOM costs at today's
  // master rates, against what the Product Master stores. The stored figure is
  // a cache written when someone last saved the BOM, so it drifts whenever a
  // purchase price or a machine / labour rate changes underneath it.
  @Get('costing/variance')
  costingVariance(@CompanyId() companyId: number | undefined) {
    return this.costing.variance(companyId);
  }

  // Write the recomputed cost onto the named products — the cost and nothing
  // else. Selling prices are commercial decisions, and each stored profit % is
  // the margin its price was set to earn, so both are left alone. Figures are
  // recomputed server-side, so the caller cannot name a cost.
  @Post('costing/apply')
  costingApply(
    @CompanyId() companyId: number | undefined,
    @Body() dto: ApplyCostingDto,
  ) {
    return this.costing.apply(companyId, dto.productIds);
  }

  // Revise selling prices after review. This is the one path that rewrites a
  // profit %: setting a price is what establishes the margin it must earn.
  @Post('costing/prices')
  costingRevisePrices(
    @CompanyId() companyId: number | undefined,
    @Body() dto: RevisePricesDto,
  ) {
    return this.costing.revisePrices(
      companyId,
      dto.revisions.map((r) => ({
        productId: r.productId,
        prices: {
          intercompany: r.intercompanyPrice,
          wholesale: r.wholesalePrice,
          retail: r.retailPrice,
        },
      })),
    );
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

  @UseGuards(
    LockPrivilegeGuard(['/inventory/products-unpacked', '/inventory/products-packed']),
  )
  @Patch(':id/lock')
  setLock(
    @CompanyId() companyId: number | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LockDto,
  ) {
    return this.service.setLock(companyId, id, dto.locked);
  }
}

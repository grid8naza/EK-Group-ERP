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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyService } from './company.service';
import { CompanyId } from '../../auth/company.decorator';
import {
  CreateCompanyDto,
  SetCompanyModulesDto,
  UpdateCompanyDto,
} from './company.dto';

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

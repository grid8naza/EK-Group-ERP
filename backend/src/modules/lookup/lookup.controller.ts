import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LookupService } from './lookup.service';
import {
  CreateLookupDto,
  CreateLookupValueDto,
  UpdateLookupDto,
  UpdateLookupValueDto,
} from './lookup.dto';

@ApiTags('lookups')
@ApiBearerAuth()
@Controller('lookups')
export class LookupController {
  constructor(private readonly service: LookupService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLookupDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLookupDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Get(':id/values')
  findValues(@Param('id', ParseIntPipe) id: number) {
    return this.service.findValues(id);
  }

  @Post(':id/values')
  createValue(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateLookupValueDto,
  ) {
    return this.service.createValueForLookup(id, dto);
  }
}

@ApiTags('lookup-values')
@ApiBearerAuth()
@Controller('lookup-values')
export class LookupValueController {
  constructor(private readonly service: LookupService) {}

  @Post()
  create(@Body() dto: CreateLookupValueDto) {
    return this.service.createValue(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOneValue(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLookupValueDto,
  ) {
    return this.service.updateValue(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeValue(id);
  }
}

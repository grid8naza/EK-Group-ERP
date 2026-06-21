import { PartialType } from '@nestjs/swagger';
import { ObjectType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateObjectDto {
  @IsInt()
  @IsNotEmpty()
  moduleId: number;

  @IsString()
  @IsNotEmpty()
  author: string;

  @IsEnum(ObjectType)
  objectType: ObjectType;

  @IsString()
  @IsNotEmpty()
  objectName: string;

  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() showInMenu?: boolean;
  @IsOptional() @IsString() nameInMenu?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() route?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsBoolean() help?: boolean;
  @IsOptional() @IsString() attachment?: string;
}

export class UpdateObjectDto extends PartialType(CreateObjectDto) {}

export class CreateObjectRevisionDto {
  @IsString()
  @IsNotEmpty()
  revisionNumber: string;

  @IsString()
  @IsNotEmpty()
  revisedBy: string;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() changesDone?: string;
}

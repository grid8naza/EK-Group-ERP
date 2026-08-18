import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateHrTeamDto {
  @ApiProperty({ example: 'Oven Team' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  /** Where the team works. Null only where the company keeps no branches. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  /** The employee who answers for it — and who marks its attendance. */
  @ApiProperty()
  @IsInt()
  leaderEmployeeId: number;

  /**
   * Who is in it. Replaced wholesale when sent: a team is one statement about
   * who works together, and a half-applied edit is a team nobody can mark.
   */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  memberIds?: number[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHrTeamDto extends CreateHrTeamDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  declare name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  declare leaderEmployeeId: number;
}

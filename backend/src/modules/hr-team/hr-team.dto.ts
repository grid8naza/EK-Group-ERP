import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * One person's membership of the team, between two dates.
 *
 * Dated rather than a bare id: which team somebody was in is a question about a
 * DAY — the sheet for the 3rd carries whoever was in the team on the 3rd — and
 * a plain list of ids can only ever answer it for today.
 */
export class HrTeamMemberDto {
  @ApiProperty()
  @IsInt()
  employeeId: number;

  /** The day they join it. YYYY-MM-DD. */
  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom: string;

  /** Their last day in it. Null / absent = still in it. */
  @ApiPropertyOptional({ nullable: true, example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  /**
   * The division (cost centre) of the work they do IN THIS TEAM — nothing to
   * do with the division on their employee record, which is where the PERSON
   * sits rather than what this team has them doing.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costCenterId?: number | null;

  /** The department (cost object) under that division. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costObjectId?: number | null;
}

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
   * The shift the TEAM works. Absent or null = none of its own, and its people
   * fall back to their own roster.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  shiftId?: number | null;

  /**
   * Who is in it, and from when until when. Replaced wholesale when sent: a
   * team is one statement about who works together, and a half-applied edit is
   * a team nobody can mark.
   */
  @ApiPropertyOptional({ type: [HrTeamMemberDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HrTeamMemberDto)
  members?: HrTeamMemberDto[];

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

/**
 * Moving people between teams.
 *
 * Its own operation rather than an edit of both teams: taking somebody out of
 * one and putting them in another has to happen together, and two saves in a
 * row is a moment where they are in neither or in both.
 */
export class TransferTeamMembersDto {
  /**
   * Where they are now — an assertion the service checks before it moves
   * anybody, so a transfer built from a stale screen cannot quietly move
   * somebody else's people. Null means "in no team".
   *
   * ABSENT means "wherever they are", for a caller moving a mixed selection
   * into one team and not claiming to know where each of them started. The
   * screen that names both sides sends it; the one that names only the
   * destination does not.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  fromTeamId?: number | null;

  /** Where they are going. Null = out of every team. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  toTeamId?: number | null;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @ArrayNotEmpty()
  employeeIds: number[];

  /**
   * The day the move takes effect. The old membership is closed the day before
   * it, so no day is claimed by two teams and none is claimed by neither.
   */
  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom: string;

  /**
   * The division and department of the work the NEW team has them doing. Asked
   * for here as well as on the form, because a transfer creates a membership
   * and a membership without them is one the team form will refuse to save.
   *
   * Ignored when moving out of every team, where no membership is created.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costCenterId?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  costObjectId?: number | null;
}

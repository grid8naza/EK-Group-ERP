import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkflowActionType, WorkflowApprovalMode } from '@prisma/client';

/** One approval level (Tab 2) within a workflow definition. */
export class WorkflowStepInput {
  @IsInt()
  @Min(1)
  sequence!: number;

  /** Approver group (used when no explicit users are named). */
  @IsOptional()
  @IsInt()
  userGroupId?: number | null;

  /** Explicit approver user ids; every one receives the task. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  userIds?: number[];

  /** Cross-boundary routing overrides (null = same as the definition). */
  @IsOptional()
  @IsInt()
  targetCompanyId?: number | null;

  @IsOptional()
  @IsInt()
  targetBranchId?: number | null;

  @IsOptional()
  @IsInt()
  targetModuleId?: number | null;

  @IsEnum(WorkflowActionType)
  action!: WorkflowActionType;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  buttonText!: string;

  /** Document status shown in the listing once this step acts. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  statusLabel?: string | null;

  @IsOptional()
  @IsEnum(WorkflowApprovalMode)
  approvalMode?: WorkflowApprovalMode;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fieldName?: string | null;

  @IsOptional()
  @IsNumber()
  valueFrom?: number | null;

  @IsOptional()
  @IsNumber()
  valueTo?: number | null;

  @IsOptional()
  @IsBoolean()
  canCancel?: boolean;

  @IsOptional()
  @IsBoolean()
  canReject?: boolean;

  @IsOptional()
  @IsBoolean()
  canEdit?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyInApp?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaHours?: number | null;
}

/** Workflow definition (Tab 1) + its steps. */
export class CreateWorkflowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsInt()
  companyId!: number;

  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @IsInt()
  moduleId!: number;

  @IsInt()
  objectId!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepInput)
  steps?: WorkflowStepInput[];
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  // company / module / object are immutable after creation (drive matching).
  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepInput)
  steps?: WorkflowStepInput[];
}

/** Start a workflow for a document (runtime). */
export class StartWorkflowDto {
  @IsInt()
  companyId!: number;

  @IsOptional()
  @IsInt()
  branchId?: number | null;

  @IsInt()
  moduleId!: number;

  @IsInt()
  objectId!: number;

  @IsInt()
  documentId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  documentRef?: string;

  /** Value tested by FIELD-approval limits (e.g. an amount). */
  @IsOptional()
  @IsNumber()
  amount?: number;

  /**
   * The document's numbers by name, for a step whose limit names one of them.
   * Keys are the engine's shared vocabulary — see LIMIT_FIELDS.
   */
  @IsOptional()
  @IsObject()
  fields?: Record<string, number>;
}

export type WorkflowActInput = 'APPROVE' | 'FORWARD' | 'REJECT' | 'CANCEL' | 'REFERENCE';

export class ActOnTaskDto {
  @IsString()
  @IsEnum(['APPROVE', 'FORWARD', 'REJECT', 'CANCEL', 'REFERENCE'])
  action!: WorkflowActInput;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

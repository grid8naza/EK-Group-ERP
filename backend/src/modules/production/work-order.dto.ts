import { IsEnum } from 'class-validator';
import { WorkOrderStatus } from '@prisma/client';

export class SetWorkOrderStatusDto {
  @IsEnum(WorkOrderStatus)
  status: WorkOrderStatus;
}

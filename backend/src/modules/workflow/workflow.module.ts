import { Module } from '@nestjs/common';
import { WorkflowDefinitionController } from './workflow-definition.controller';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowRuntimeController } from './workflow-runtime.controller';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { WorkflowStatusController } from './workflow-status.controller';
import { WorkflowStatusService } from './workflow-status.service';

@Module({
  controllers: [
    WorkflowDefinitionController,
    WorkflowRuntimeController,
    WorkflowStatusController,
  ],
  providers: [
    WorkflowDefinitionService,
    WorkflowRuntimeService,
    WorkflowStatusService,
  ],
})
export class WorkflowModule {}

import { Module } from '@nestjs/common';
import { WorkflowDefinitionController } from './workflow-definition.controller';
import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowRuntimeController } from './workflow-runtime.controller';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@Module({
  controllers: [WorkflowDefinitionController, WorkflowRuntimeController],
  providers: [WorkflowDefinitionService, WorkflowRuntimeService],
})
export class WorkflowModule {}

import { Module } from '@nestjs/common';
import { ScaffoldService } from './scaffold.service';

@Module({ providers: [ScaffoldService] })
export class ScaffoldModule {}

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { syncScaffold } from './scaffold.sync';

/**
 * Runs the module/menu scaffold sync once, after all modules have initialised.
 * Keeps every developer's database in step with MODULE_SCAFFOLDS on each start.
 */
@Injectable()
export class ScaffoldService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScaffoldService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await syncScaffold(this.prisma);
      this.logger.log('Module/menu scaffold synced.');
    } catch (e) {
      this.logger.error(
        `Scaffold sync failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}

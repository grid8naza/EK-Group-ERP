import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  METRIC_PROVIDER,
  MetricContext,
  MetricDef,
  MetricFormat,
  MetricProviderPort,
} from '../../contracts/metric-provider.port';

export interface MetricOption {
  key: string;
  label: string;
  format: MetricFormat;
}

export interface MetricValue {
  value: number;
  format: MetricFormat;
  label: string;
}

/**
 * Aggregates every module's metric definitions (collected via the
 * METRIC_PROVIDER multi-token) into one lookup. The widget builder lists the
 * metrics available for a module; the dashboard renderer computes their values
 * for the active company. No feature module is imported here — only the
 * contracts token — so isolation is preserved.
 */
@Injectable()
export class MetricRegistryService {
  private readonly defs = new Map<string, MetricDef>();

  constructor(
    @Inject(METRIC_PROVIDER) providers: MetricProviderPort[],
    private readonly prisma: PrismaService,
  ) {
    // `providers` is empty if no module registered metrics; multi-tokens always
    // resolve to an array.
    for (const provider of providers ?? []) {
      for (const def of provider.metrics()) {
        this.defs.set(def.key, def);
      }
    }
  }

  /** Metrics offered for a module's widgets (matched by the module's code). */
  async listForModule(moduleId: number): Promise<MetricOption[]> {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { code: true },
    });
    if (!mod) return [];
    return [...this.defs.values()]
      .filter((d) => d.moduleCode === mod.code)
      .map((d) => ({ key: d.key, label: d.label, format: d.format ?? 'number' }));
  }

  /** Compute several metrics at once for one company/branch scope. */
  async computeMany(
    keys: string[],
    ctx: MetricContext,
  ): Promise<Record<string, MetricValue>> {
    const unique = [...new Set(keys)].filter((k) => this.defs.has(k));
    const out: Record<string, MetricValue> = {};
    await Promise.all(
      unique.map(async (key) => {
        const def = this.defs.get(key)!;
        const format = def.format ?? 'number';
        try {
          out[key] = { value: await def.compute(ctx), format, label: def.label };
        } catch {
          // A failing metric shouldn't break the whole dashboard.
          out[key] = { value: 0, format, label: def.label };
        }
      }),
    );
    return out;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUnlocked } from '../../common/assert-unlocked';
import {
  CreateDashboardDto,
  SaveLayoutDto,
  SetWidgetsDto,
  UpdateDashboardDto,
} from './dashboard.dto';

interface LayoutEntry {
  widgetId: number;
  sortOrder: number;
  hidden?: boolean;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // ---- Admin listing / CRUD (cpanel) ----

  findAll(companyId: number, moduleId?: number, branchId?: number) {
    return this.prisma.dashboard.findMany({
      where: {
        companyId,
        ...(moduleId ? { moduleId } : {}),
        ...(branchId ? { branchId } : {}),
      },
      include: {
        module: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { widgets: true } },
      },
      orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  create(dto: CreateDashboardDto, companyId: number) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.dashboard.create({
        data: { ...dto, companyId },
      });
      if (created.isDefault) {
        await this.clearOtherDefaults(tx, created);
      }
      return created;
    });
  }

  async update(id: number, dto: UpdateDashboardDto) {
    const existing = await this.ensure(id);
    assertUnlocked(existing, 'dashboard', 'editing');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dashboard.update({ where: { id }, data: dto });
      if (updated.isDefault) {
        await this.clearOtherDefaults(tx, updated);
      }
      return updated;
    });
  }

  async setLock(id: number, locked: boolean) {
    await this.ensure(id);
    return this.prisma.dashboard.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  /**
   * Only one dashboard per (company, module, branch) may be the default.
   * Whenever a dashboard is marked default, unset the flag on every other
   * dashboard in the same company + module + branch (branchId null = the
   * company-wide set keeps its own single default).
   */
  private clearOtherDefaults(
    tx: Prisma.TransactionClient,
    dashboard: {
      id: number;
      companyId: number;
      moduleId: number;
      branchId: number | null;
    },
  ) {
    return tx.dashboard.updateMany({
      where: {
        companyId: dashboard.companyId,
        moduleId: dashboard.moduleId,
        branchId: dashboard.branchId,
        id: { not: dashboard.id },
        isDefault: true,
      },
      data: { isDefault: false },
    });
  }

  async remove(id: number) {
    const existing = await this.ensure(id);
    assertUnlocked(existing, 'dashboard', 'deleting');
    await this.prisma.dashboard.delete({ where: { id } });
    return { success: true };
  }

  /** Widget catalog available to place on a dashboard (company + module). */
  widgetCatalog(companyId: number, moduleId: number) {
    return this.prisma.widget.findMany({
      where: { companyId, moduleId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Replace a dashboard's default widget set + order (admin). */
  async setWidgets(id: number, dto: SetWidgetsDto) {
    await this.ensure(id);
    await this.prisma.$transaction([
      this.prisma.dashboardWidget.deleteMany({ where: { dashboardId: id } }),
      ...dto.widgets.map((w, i) =>
        this.prisma.dashboardWidget.create({
          data: {
            dashboardId: id,
            widgetId: w.widgetId,
            sortOrder: i + 1,
            width: w.width ?? 1,
          },
        }),
      ),
    ]);
    return this.getOne(id, undefined);
  }

  // ---- Runtime (the dashboard page) ----

  /**
   * Returns the dashboard with its widgets resolved to widget metadata, in the
   * effective order for `userId` (their saved personal layout if any, else the
   * admin default).
   */
  async getOne(id: number, userId?: number) {
    const dashboard = await this.prisma.dashboard.findUnique({
      where: { id },
      include: {
        widgets: {
          include: { widget: true },
          orderBy: { sortOrder: 'asc' },
        },
        module: { select: { id: true, name: true, code: true } },
      },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');

    let layout: LayoutEntry[] | null = null;
    if (userId) {
      const personal = await this.prisma.userDashboardLayout.findUnique({
        where: { userId_dashboardId: { userId, dashboardId: id } },
      });
      if (personal && Array.isArray(personal.layout)) {
        layout = personal.layout as unknown as LayoutEntry[];
      }
    }
    const order = new Map<number, LayoutEntry>(
      (layout ?? []).map((l) => [l.widgetId, l]),
    );

    const widgets = dashboard.widgets
      .map((w) => {
        const personal = order.get(w.widgetId);
        return {
          widgetId: w.widgetId,
          code: w.widget.code,
          name: w.widget.name,
          description: w.widget.description,
          type: w.widget.type,
          config: w.widget.config,
          width: w.width,
          hidden: personal?.hidden ?? false,
          sortOrder: personal?.sortOrder ?? w.sortOrder,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      id: dashboard.id,
      name: dashboard.name,
      icon: dashboard.icon,
      moduleId: dashboard.moduleId,
      module: dashboard.module,
      isCustomized: !!layout,
      widgets,
    };
  }

  /** Save the current user's personal arrangement of a dashboard. */
  async saveLayout(id: number, userId: number, dto: SaveLayoutDto) {
    await this.ensure(id);
    const layout = dto.widgets.map((w, i) => ({
      widgetId: w.widgetId,
      sortOrder: i + 1,
      hidden: w.hidden ?? false,
    }));
    await this.prisma.userDashboardLayout.upsert({
      where: { userId_dashboardId: { userId, dashboardId: id } },
      create: { userId, dashboardId: id, layout },
      update: { layout },
    });
    return this.getOne(id, userId);
  }

  /** Reset the current user's personal arrangement back to the default. */
  async resetLayout(id: number, userId: number) {
    await this.prisma.userDashboardLayout.deleteMany({
      where: { userId, dashboardId: id },
    });
    return this.getOne(id, userId);
  }

  private async ensure(id: number) {
    const d = await this.prisma.dashboard.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Dashboard not found');
    return d;
  }
}

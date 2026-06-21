import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateMainMenuDto,
  CreateSubMenuDto,
  ReorderDto,
  UpdateMainMenuDto,
  UpdateSubMenuDto,
} from './menu.dto';

@Injectable()
export class MenuService {
  constructor(private prisma: PrismaService) {}

  // ---- Main Menus ----
  findAllMainMenus(companyId: number, moduleId?: number) {
    return this.prisma.mainMenu.findMany({
      where: { companyId, ...(moduleId ? { moduleId } : {}) },
      include: {
        subMenus: { orderBy: { sortOrder: 'asc' } },
        module: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOneMainMenu(id: number) {
    const mainMenu = await this.prisma.mainMenu.findUnique({
      where: { id },
      include: {
        subMenus: { orderBy: { sortOrder: 'asc' } },
        module: true,
      },
    });
    if (!mainMenu) throw new NotFoundException('Main menu not found');
    return mainMenu;
  }

  createMainMenu(dto: CreateMainMenuDto, companyId: number) {
    return this.prisma.mainMenu.create({ data: { ...dto, companyId } });
  }

  async updateMainMenu(id: number, dto: UpdateMainMenuDto) {
    await this.ensureMainMenu(id);
    return this.prisma.mainMenu.update({ where: { id }, data: dto });
  }

  async removeMainMenu(id: number) {
    await this.ensureMainMenu(id);
    await this.prisma.mainMenu.delete({ where: { id } });
    return { success: true };
  }

  // Persist a drag-reordered list of main menus (ids in their new order).
  async reorderMainMenus(dto: ReorderDto) {
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.mainMenu.update({
          where: { id },
          data: { sortOrder: index + 1 },
        }),
      ),
    );
    return { success: true };
  }

  // ---- Sub Menus ----
  findAllSubMenus(mainMenuId?: number) {
    return this.prisma.subMenu.findMany({
      where: mainMenuId ? { mainMenuId } : undefined,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOneSubMenu(id: number) {
    const subMenu = await this.prisma.subMenu.findUnique({ where: { id } });
    if (!subMenu) throw new NotFoundException('Sub menu not found');
    return subMenu;
  }

  createSubMenu(dto: CreateSubMenuDto) {
    return this.prisma.subMenu.create({ data: dto });
  }

  async updateSubMenu(id: number, dto: UpdateSubMenuDto) {
    await this.findOneSubMenu(id);
    return this.prisma.subMenu.update({ where: { id }, data: dto });
  }

  async removeSubMenu(id: number) {
    await this.findOneSubMenu(id);
    await this.prisma.subMenu.delete({ where: { id } });
    return { success: true };
  }

  // Persist a drag-reordered list of sub menus (ids in their new order).
  async reorderSubMenus(dto: ReorderDto) {
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.subMenu.update({
          where: { id },
          data: { sortOrder: index + 1 },
        }),
      ),
    );
    return { success: true };
  }

  // ---- Tree ----
  tree(companyId: number, moduleId?: number) {
    return this.prisma.mainMenu.findMany({
      where: { companyId, ...(moduleId ? { moduleId } : {}) },
      include: {
        subMenus: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async ensureMainMenu(id: number) {
    const mainMenu = await this.prisma.mainMenu.findUnique({ where: { id } });
    if (!mainMenu) throw new NotFoundException('Main menu not found');
    return mainMenu;
  }
}

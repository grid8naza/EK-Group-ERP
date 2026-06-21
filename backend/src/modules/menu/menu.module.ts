import { Module } from '@nestjs/common';
import { MenuService } from './menu.service';
import {
  MainMenuController,
  MenuController,
  SubMenuController,
} from './menu.controller';

@Module({
  controllers: [MainMenuController, SubMenuController, MenuController],
  providers: [MenuService],
})
export class MenuModule {}

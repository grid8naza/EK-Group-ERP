import { Module } from '@nestjs/common';
import { LoginScreenController } from './login-screen.controller';
import { LoginScreenService } from './login-screen.service';

@Module({
  controllers: [LoginScreenController],
  providers: [LoginScreenService],
})
export class LoginScreenModule {}

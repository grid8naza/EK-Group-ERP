import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

/**
 * Internal mail — part of the Workplace module's surface (SRS §8.11), served
 * from its own NestJS module so chat, tasks and the approval engine stay
 * separable from it. Reads people through the USER_LOOKUP port, so it imports
 * no other feature module.
 */
@Module({
  controllers: [MailController],
  providers: [MailService],
})
export class MailModule {}

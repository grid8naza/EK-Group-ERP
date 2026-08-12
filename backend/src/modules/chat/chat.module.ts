import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatEventsService } from './chat-events.service';

/**
 * Internal chat — part of the Workplace module's surface (SRS §8.11), served
 * from its own NestJS module so mail, tasks and the approval engine stay
 * separable from it. Reads people through the USER_LOOKUP port, so it imports
 * no other feature module.
 */
@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatEventsService],
})
export class ChatModule {}

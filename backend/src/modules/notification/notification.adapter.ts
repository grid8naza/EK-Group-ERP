import { Injectable } from '@nestjs/common';
import {
  NotificationPort,
  PublishNotification,
} from '../../contracts/notification.port';
import { NotificationService } from './notification.service';

/**
 * The notification module's in-process implementation of NotificationPort.
 *
 * A thin pass-through, and that is the point: the port exists so a publisher
 * depends on the INTERFACE, not on this module. When alerts move to a service of
 * their own, this file is replaced by a remote client and no publisher changes.
 *
 * Allowed imports here: the port + this module's own service.
 */
@Injectable()
export class NotificationAdapter implements NotificationPort {
  constructor(private readonly service: NotificationService) {}

  publish(input: PublishNotification): Promise<number> {
    return this.service.publish(input);
  }

  resolve(sourceKeys: string[]): Promise<void> {
    return this.service.resolve(sourceKeys);
  }

  resolveMissing(prefix: string, keep: string[]): Promise<void> {
    return this.service.resolveMissing(prefix, keep);
  }
}

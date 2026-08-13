import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateSync } from 'class-validator';

/**
 * Run a DTO's own rules over an object that did not arrive in a request body.
 *
 * Sending a saved draft goes straight to the service, so it never passes the
 * global ValidationPipe — and a draft is stored loosely on purpose, half
 * written, with everything optional. Without this, saving and then sending
 * would be a way to put content into the system that a direct request could
 * not: over the length limit, or with a field the strict DTO would have
 * rejected. So the strict DTO is applied here by hand, and the draft path ends
 * up held to exactly the rules the direct path is.
 */
export function validateAs<T extends object>(
  cls: new () => T,
  plain: unknown,
): T {
  const instance = plainToInstance(cls, plain ?? {}, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(instance as object, {
    whitelist: true,
    forbidUnknownValues: false,
  });
  if (errors.length > 0) {
    throw new BadRequestException(messagesOf(errors));
  }
  return instance;
}

/** Every constraint message in the tree, flattened for the error response. */
function messagesOf(errors: ValidationError[]): string[] {
  const out: string[] = [];
  const walk = (list: ValidationError[]) => {
    for (const error of list) {
      if (error.constraints) out.push(...Object.values(error.constraints));
      if (error.children?.length) walk(error.children);
    }
  };
  walk(errors);
  return out;
}

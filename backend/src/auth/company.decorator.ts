import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Reads the active company id from the `X-Company-Id` request header.
 * Returns `undefined` when absent so services can fall back to the user's
 * default company.
 */
export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const raw =
      request.headers['x-company-id'] ?? request.headers['X-Company-Id'];
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  },
);

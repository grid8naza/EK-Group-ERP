import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Reads the active branch id from the `X-Branch-Id` request header.
 * Returns `undefined` when absent so the profile builder can fall back to the
 * user's first accessible branch (mirrors company.decorator.ts).
 */
export const BranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const raw = request.headers['x-branch-id'] ?? request.headers['X-Branch-Id'];
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  },
);

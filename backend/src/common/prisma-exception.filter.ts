import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Turns Prisma's known database errors into clean HTTP responses instead of a
 * generic 500. Registered globally in main.ts.
 *
 * It only catches PrismaClientKnownRequestError, so HttpExceptions thrown by
 * services (BadRequest/Conflict/NotFound/...) are left to Nest's default
 * handling. The response body matches Nest's standard shape
 * ({ statusCode, message, error }) so the frontend reads `message` as usual.
 *
 * Example: editing a Company to a code another company already uses now returns
 * 409 "A record with the same code already exists." instead of 500.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const httpError = this.toHttpException(exception);
    const status = httpError.getStatus();

    // Unmapped Prisma errors fall through as 500 — log them for diagnosis.
    if (status >= 500) {
      this.logger.error(
        `Unmapped Prisma error ${exception.code}: ${exception.message}`,
      );
    }

    response.status(status).json(httpError.getResponse());
  }

  private toHttpException(
    e: Prisma.PrismaClientKnownRequestError,
  ): HttpException {
    switch (e.code) {
      // Unique constraint violation.
      case 'P2002':
        return new ConflictException(
          `A record with the same ${this.fields(e) ?? 'value'} already exists.`,
        );

      // Record required by the operation was not found (update/delete).
      case 'P2025':
        return new NotFoundException(
          typeof e.meta?.cause === 'string'
            ? e.meta.cause
            : 'The requested record was not found.',
        );

      // Foreign key constraint violation.
      case 'P2003':
        return new ConflictException(
          'This record is linked to other records, so it cannot be changed or deleted while those exist.',
        );

      // Value too long for the column.
      case 'P2000':
        return new BadRequestException(
          'A provided value is too long for one of the fields.',
        );

      default:
        return new InternalServerErrorException('A database error occurred.');
    }
  }

  /** Best-effort human name(s) of the field(s) that triggered the error. */
  private fields(e: Prisma.PrismaClientKnownRequestError): string | null {
    const target = e.meta?.target;
    // Prisma usually reports an array of field names — use them directly.
    if (Array.isArray(target)) return target.length ? target.join(', ') : null;
    // Some setups report a raw constraint-name string (e.g.
    // production_orders_companyId_orderNo_key). Table names and composite keys
    // both contain underscores, so the field names can't be recovered reliably
    // — fall back to the generic message instead of a garbled label.
    return null;
  }
}

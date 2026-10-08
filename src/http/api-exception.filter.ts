import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .json(
          typeof body === 'string'
            ? { statusCode: exception.getStatus(), message: body }
            : body,
        );
      return;
    }
    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      response
        .status(409)
        .json({
          statusCode: 409,
          message: 'A record with this unique value already exists',
        });
      return;
    }
    const parserError = exception as { type?: unknown } | null;
    if (
      parserError?.type === 'entity.too.large' ||
      parserError?.type === 'entity.parse.failed'
    ) {
      const tooLarge = parserError.type === 'entity.too.large';
      const status = tooLarge ? 413 : 400;
      response.status(status).json({
        statusCode: status,
        message: tooLarge ? 'Request body too large' : 'Invalid JSON body',
      });
      return;
    }
    // Request bodies, tokens, queries and raw driver exceptions are never logged.
    this.logger.error('Unexpected request failure');
    response
      .status(500)
      .json({ statusCode: 500, message: 'Internal server error' });
  }
}

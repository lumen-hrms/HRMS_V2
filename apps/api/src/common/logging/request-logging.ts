import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * One log line per API call, written when the response finishes:
 *
 *   INFO  [HTTP] LeaveController.approve POST /api/leave/requests/:id/approve -> 200 (312 ms) user=hr@acme.test tenant=acme
 *   WARN  [HTTP] LeaveController.approve POST /api/leave/requests/:id/approve -> 400 (95 ms) user=hr@acme.test tenant=acme — failed: Request is not pending approval
 *
 * 2xx/3xx log at INFO, 4xx at WARN, 5xx at ERROR (the 5xx stack trace is
 * still printed separately by Nest's exception handler). The route pattern
 * is logged rather than the raw URL, so ids and query strings stay out.
 */
const logger = new Logger('HTTP');
const QUIET_PATHS = new Set(['/api/health']);

type LoggedRequest = Request & {
  user?: { email?: string };
  tenantSubdomain?: string;
};

/** `res.locals` keys: which controller method handled the call (set by
 *  `HandlerNameInterceptor`) and why it failed (set by `ErrorReasonFilter`). */
const HANDLER = 'logHandlerName';
const FAILURE = 'logFailureReason';

export function requestLogging(req: LoggedRequest, res: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (QUIET_PATHS.has(path)) return;
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const handler = (res.locals[HANDLER] as string | undefined) ?? '';
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : path;
    const who = [
      req.user?.email && `user=${req.user.email}`,
      req.tenantSubdomain && `tenant=${req.tenantSubdomain}`,
    ]
      .filter(Boolean)
      .join(' ');
    const failure = res.locals[FAILURE] as string | undefined;
    const line =
      `${handler ? `${handler} ` : ''}${req.method} ${route} -> ${res.statusCode} (${ms} ms)` +
      `${who ? ` ${who}` : ''}${failure ? ` — failed: ${failure}` : ''}`;

    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });
  next();
}

@Injectable()
export class HandlerNameInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const res = context.switchToHttp().getResponse<Response>();
      res.locals[HANDLER] = `${context.getClass().name}.${context.getHandler().name}`;
    }
    return next.handle();
  }
}

/** Records the failure reason for the request log, then answers exactly as Nest would. */
@Catch()
export class ErrorReasonFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      host.switchToHttp().getResponse<Response>().locals[FAILURE] = failureReason(exception);
    }
    super.catch(exception, host);
  }
}

export function failureReason(exception: unknown): string {
  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: unknown }).message
        : body;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  // Unexpected errors: the type only — the full error + stack is printed by
  // Nest's exception handler right before this line.
  return exception instanceof Error
    ? `${exception.constructor.name} (see stack trace above)`
    : 'unknown error';
}

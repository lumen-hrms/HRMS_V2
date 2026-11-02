import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformJwtAuthGuard } from '../common/guards/platform-jwt-auth.guard';
import type { AuthenticatedPlatformAdmin } from '../platform-admin/platform-admin.types';
import { EmailSuppressionService } from './email-suppression.service';

/**
 * Public: SNS POSTs SES bounce/complaint events here (module 10 §4.4).
 * Authenticated by the SNS signature + the configured topic ARN, not a
 * session. No tenant context. SNS sends `text/plain`, parsed as a string.
 */
@Controller('notifications/ses-events')
export class SesEventsWebhookController {
  constructor(private readonly suppressions: EmailSuppressionService) {}

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown) {
    return { status: await this.suppressions.handleSnsWebhook(body) };
  }
}

/** Operator view of the suppression list (Platform Admin › Settings). */
@UseGuards(PlatformJwtAuthGuard)
@Controller('platform-admin/email-suppressions')
export class EmailSuppressionOperatorController {
  constructor(private readonly suppressions: EmailSuppressionService) {}

  @Get()
  list() {
    return this.suppressions.list();
  }

  @Delete(':email')
  lift(@Param('email') email: string, @Req() req: Request & { user?: AuthenticatedPlatformAdmin }) {
    return this.suppressions.lift(email, req.user?.email ?? 'unknown');
  }
}

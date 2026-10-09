import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformJwtAuthGuard } from '../common/guards/platform-jwt-auth.guard';
import type { AuthenticatedPlatformAdmin } from '../platform-admin/platform-admin.types';
import { BillingService } from './billing.service';

/** Public: authenticated by Razorpay's signature, not a session. No tenant context. */
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    const result = await this.billing.handleWebhook(req.rawBody, signature, eventId);
    return { status: result };
  }
}

/** Operator-only routes under the platform-admin prefix. */
@Controller('platform-admin')
export class BillingOperatorController {
  constructor(private readonly billing: BillingService) {}

  @UseGuards(PlatformJwtAuthGuard)
  @Post('tenants/:id/billing/subscribe')
  subscribe(@Param('id') id: string, @Req() req: Request & { user?: AuthenticatedPlatformAdmin }) {
    return this.billing.subscribeTenant(id, req.user?.email);
  }

  @UseGuards(PlatformJwtAuthGuard)
  @Get('tenants/:id/payments')
  payments(@Param('id') id: string) {
    return this.billing.listPayments(id);
  }
}

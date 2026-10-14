import { Module } from '@nestjs/common';
import { BillingOperatorController, BillingWebhookController } from './billing.controller';
import { BillingService } from './billing.service';
import { RazorpayClient } from './razorpay.client';

@Module({
  controllers: [BillingWebhookController, BillingOperatorController],
  providers: [BillingService, RazorpayClient],
  exports: [BillingService],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { LeaveEntitlementService } from './leave-entitlement.service';

/**
 * Just the policy engine, with no queue/notification dependencies — so
 * Employee Master (a new hire's opening balances) and company setup can use
 * it without importing all of `LeaveModule`.
 */
@Module({
  providers: [LeaveEntitlementService],
  exports: [LeaveEntitlementService],
})
export class LeaveEntitlementModule {}

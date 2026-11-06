import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { BillingService, GRACE_DAYS } from './billing.service';

const SECRET = 'whsec_test';
const sign = (body: Buffer) => createHmac('sha256', SECRET).update(body).digest('hex');
const DAY_MS = 86_400_000;

function setup(
  opts: {
    sub?: any;
    duplicate?: boolean;
  } = {},
) {
  const tx = {
    subscription: {
      findUnique: jest.fn().mockResolvedValue(opts.sub === undefined ? defaultSub() : opts.sub),
      update: jest.fn().mockResolvedValue({}),
    },
    billingEvent: {
      create: jest.fn().mockImplementation(() =>
        opts.duplicate
          ? Promise.reject(
              new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: 'x',
              }),
            )
          : Promise.resolve({}),
      ),
    },
    payment: { create: jest.fn().mockResolvedValue({}) },
    tenant: { update: jest.fn().mockResolvedValue({}) },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    tenant: { ...tx.tenant, findMany: jest.fn().mockResolvedValue([]) },
    payment: { ...tx.payment, findMany: jest.fn().mockResolvedValue([]) },
  };
  const razorpay = {
    webhookSecret: SECRET,
    createPlan: jest.fn().mockResolvedValue({ id: 'plan_1' }),
    createSubscription: jest.fn().mockResolvedValue({ id: 'sub_1', short_url: 'https://rzp.io/x' }),
  };
  return { service: new BillingService(prisma as any, razorpay as any), tx, prisma, razorpay };
}

function defaultSub(over: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    graceEndsAt: null,
    tenant: { id: 't1', status: 'TRIAL' },
    ...over,
  };
}

function webhook(event: string, extra: Record<string, unknown> = {}) {
  const body = Buffer.from(
    JSON.stringify({
      event,
      payload: { subscription: { entity: { id: 'sub_1', current_end: 1_800_000_000 } }, ...extra },
    }),
  );
  return { body, sig: sign(body) };
}
const charged = {
  payment: { entity: { id: 'pay_1', amount: 1234500, currency: 'INR', created_at: 1_790_000_000 } },
};

describe('BillingService.handleWebhook', () => {
  it('rejects a bad signature without touching the database', async () => {
    const { service, prisma } = setup();
    const { body } = webhook('subscription.charged', charged);
    await expect(service.handleWebhook(body, 'deadbeef', 'e1')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a missing signature or body', async () => {
    const { service } = setup();
    await expect(service.handleWebhook(undefined, 'x', 'e1')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.handleWebhook(Buffer.from('{}'), undefined, 'e1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects everything when no webhook secret is configured', async () => {
    const { service, razorpay } = setup();
    (razorpay as any).webhookSecret = undefined;
    const { body, sig } = webhook('subscription.charged', charged);
    await expect(service.handleWebhook(body, sig, 'e1')).rejects.toThrow(UnauthorizedException);
  });

  it('subscription.charged records the payment in rupees, activates a trial tenant and clears trial/grace', async () => {
    const { service, tx } = setup();
    const { body, sig } = webhook('subscription.charged', charged);

    expect(await service.handleWebhook(body, sig, 'evt_1')).toBe('applied');

    const pay = tx.payment.create.mock.calls[0][0].data;
    expect(pay.razorpayPaymentId).toBe('pay_1');
    expect(pay.amount.toString()).toBe('12345');
    expect(tx.subscription.update.mock.calls[0][0].data).toEqual({
      trialEndsAt: null,
      graceEndsAt: null,
      renewsAt: new Date(1_800_000_000 * 1000),
    });
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'ACTIVE' },
    });
    expect(tx.platformAuditLog.create.mock.calls[0][0].data.action).toBe(
      'billing.payment_received',
    );
  });

  it('a successful charge reopens a READ_ONLY tenant', async () => {
    const { service, tx } = setup({
      sub: defaultSub({ tenant: { id: 't1', status: 'READ_ONLY' } }),
    });
    const { body, sig } = webhook('subscription.charged', charged);
    await service.handleWebhook(body, sig, 'evt_2');
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'ACTIVE' },
    });
  });

  it('a payment never reactivates a SUSPENDED tenant', async () => {
    const { service, tx } = setup({
      sub: defaultSub({ tenant: { id: 't1', status: 'SUSPENDED' } }),
    });
    const { body, sig } = webhook('subscription.charged', charged);
    await service.handleWebhook(body, sig, 'evt_3');
    expect(tx.payment.create).toHaveBeenCalled();
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });

  it('applies a redelivered event only once', async () => {
    const { service, tx } = setup({ duplicate: true });
    const { body, sig } = webhook('subscription.charged', charged);
    expect(await service.handleWebhook(body, sig, 'evt_1')).toBe('duplicate');
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });

  it('ignores an unknown subscription id', async () => {
    const { service, tx } = setup({ sub: null });
    const { body, sig } = webhook('subscription.charged', charged);
    expect(await service.handleWebhook(body, sig, 'evt_4')).toBe('ignored');
    expect(tx.billingEvent.create).not.toHaveBeenCalled();
  });

  it('ignores event types it does not handle', async () => {
    const { service, tx } = setup();
    const { body, sig } = webhook('subscription.updated');
    expect(await service.handleWebhook(body, sig, 'evt_5')).toBe('ignored');
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });

  it('subscription.pending starts a grace window once and does not extend it', async () => {
    const { service, tx } = setup({ sub: defaultSub({ tenant: { id: 't1', status: 'ACTIVE' } }) });
    const { body, sig } = webhook('subscription.pending');
    await service.handleWebhook(body, sig, 'evt_6');
    const grace: Date = tx.subscription.update.mock.calls[0][0].data.graceEndsAt;
    expect(Math.round((grace.getTime() - Date.now()) / DAY_MS)).toBe(GRACE_DAYS);

    const again = setup({
      sub: defaultSub({ graceEndsAt: new Date(), tenant: { id: 't1', status: 'ACTIVE' } }),
    });
    await again.service.handleWebhook(body, sig, 'evt_7');
    expect(again.tx.subscription.update).not.toHaveBeenCalled();
  });

  it.each(['subscription.halted', 'subscription.cancelled'])(
    '%s moves an ACTIVE tenant to READ_ONLY',
    async (evt) => {
      const { service, tx } = setup({
        sub: defaultSub({ tenant: { id: 't1', status: 'ACTIVE' } }),
      });
      const { body, sig } = webhook(evt);
      await service.handleWebhook(body, sig, `e_${evt}`);
      expect(tx.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'READ_ONLY' },
      });
    },
  );

  it('halted never overrides a SUSPENDED tenant', async () => {
    const { service, tx } = setup({
      sub: defaultSub({ tenant: { id: 't1', status: 'SUSPENDED' } }),
    });
    const { body, sig } = webhook('subscription.halted');
    await service.handleWebhook(body, sig, 'e_h');
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });
});

describe('BillingService.subscribeTenant', () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    plan: 'GROWTH',
    seats: 50,
    pricePerSeat: new Prisma.Decimal('199.50'),
    razorpaySubscriptionId: null,
    tenant: { name: 'Acme' },
    ...over,
  });

  it('prices the plan as rate × seats in paise and stores the subscription id', async () => {
    const { service, prisma, razorpay } = setup();
    (prisma as any).subscription.findUnique.mockResolvedValue(sub());
    const res = await service.subscribeTenant('t1', 'ops@x.test');
    expect(razorpay.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 997500 }),
    );
    expect(razorpay.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan_1', tenantId: 't1' }),
    );
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      data: { razorpaySubscriptionId: 'sub_1' },
    });
    expect(res).toEqual({ subscriptionId: 'sub_1', paymentUrl: 'https://rzp.io/x' });
  });

  it('refuses a tenant that already has a Razorpay subscription', async () => {
    const { service, prisma, razorpay } = setup();
    (prisma as any).subscription.findUnique.mockResolvedValue(
      sub({ razorpaySubscriptionId: 'sub_0' }),
    );
    await expect(service.subscribeTenant('t1')).rejects.toThrow(BadRequestException);
    expect(razorpay.createPlan).not.toHaveBeenCalled();
  });

  it('refuses a zero price before calling Razorpay', async () => {
    const { service, prisma, razorpay } = setup();
    (prisma as any).subscription.findUnique.mockResolvedValue(sub({ pricePerSeat: null }));
    await expect(service.subscribeTenant('t1')).rejects.toThrow('price per seat');
    expect(razorpay.createPlan).not.toHaveBeenCalled();
  });
});

describe('BillingService.enforceGrace', () => {
  it('moves overdue ACTIVE tenants to READ_ONLY and audits each', async () => {
    const { service, prisma } = setup();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const now = new Date();
    expect(await service.enforceGrace(now)).toBe(2);
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', subscription: { is: { graceEndsAt: { lte: now } } } },
      }),
    );
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { status: 'READ_ONLY' },
    });
    expect(prisma.platformAuditLog.create).toHaveBeenCalledTimes(2);
  });
});

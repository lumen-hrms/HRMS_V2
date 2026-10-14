import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { BillingWebhookController } from './billing.controller';
import { BillingService } from './billing.service';

describe('POST /billing/webhooks/razorpay (raw body over HTTP)', () => {
  let app: INestApplication;
  const handleWebhook = jest.fn().mockResolvedValue('applied');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [BillingWebhookController],
      providers: [{ provide: BillingService, useValue: { handleWebhook } }],
    }).compile();
    app = mod.createNestApplication({ rawBody: true });
    await app.init();
  });
  afterAll(() => app.close());

  it('passes the exact bytes, signature and event id to the service', async () => {
    // Odd spacing on purpose: re-serialised JSON would not match the signature.
    const raw = '{ "event":"subscription.charged",  "payload":{} }';
    const sig = createHmac('sha256', 's').update(raw).digest('hex');

    const res = await request(app.getHttpServer())
      .post('/billing/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', sig)
      .set('X-Razorpay-Event-Id', 'evt_9')
      .send(raw);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'applied' });
    const [body, signature, eventId] = handleWebhook.mock.calls[0];
    expect((body as Buffer).toString('utf8')).toBe(raw);
    expect(signature).toBe(sig);
    expect(eventId).toBe('evt_9');
  });
});

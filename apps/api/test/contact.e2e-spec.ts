import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createFirebaseTestUser,
  deleteTrackedFirebaseUsers,
  getIdTokenForEmail,
  superuserPrisma,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * The public "Contact us" form (`POST /api/contact`, no tenant, no auth)
 * plus the Platform Admin surface that reads it (`GET /leads`) and
 * configures who gets notified (`GET`/`PATCH /settings`).
 */
describe('Contact form + Platform Admin settings/leads (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  const email = `contact-e2e-admin+${Date.now()}@example.test`;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();

    const uid = await createFirebaseTestUser(email, { type: 'platform_admin' });
    await superuserPrisma.platformAdminUser.create({
      data: { email, firebaseUid: uid, fullName: 'Contact E2E Admin' },
    });
    adminToken = await getIdTokenForEmail(email);
  }, 60_000);

  afterAll(async () => {
    await superuserPrisma.platformAdminUser.deleteMany({ where: { email } });
    await superuserPrisma.contactSubmission.deleteMany({ where: { email: 'lead@e2e.test' } });
    // platform_settings is a singleton shared across the whole DB, not
    // per-test state — leave it as this suite found it (empty) so other
    // suites in the same run don't see a stale recipient list.
    await superuserPrisma.platformSettings.deleteMany({ where: { id: 'singleton' } });
    await deleteTrackedFirebaseUsers();
    await superuserPrisma.$disconnect();
    await app.close();
  });

  describe('POST /api/contact', () => {
    it('accepts a valid submission with no auth and no tenant header', async () => {
      const res = await request(server()).post('/api/contact').send({
        name: 'Lead Person',
        email: 'lead@e2e.test',
        company: 'Acme Hospital',
        phone: '9999999999',
        message: 'We would like to see a demo of Lumen HRMS for our team.',
      });
      expect(res.status).toBe(202);

      const row = await superuserPrisma.contactSubmission.findFirst({
        where: { email: 'lead@e2e.test' },
      });
      expect(row).toMatchObject({ name: 'Lead Person', company: 'Acme Hospital' });
    });

    it('rejects a malformed submission', async () => {
      const res = await request(server())
        .post('/api/contact')
        .send({ name: 'x', email: 'not-an-email', message: 'too short' });
      expect(res.status).toBe(400);
    });

    it('rate-limits repeated submissions from the same email', async () => {
      const body = {
        name: 'Spammer',
        email: 'ratelimit@e2e.test',
        company: 'Spam Inc',
        phone: '9999999999',
        message: 'Please contact me about your product offering.',
      };
      for (let i = 0; i < 3; i++) {
        const ok = await request(server()).post('/api/contact').send(body);
        expect(ok.status).toBe(202);
      }
      const blocked = await request(server()).post('/api/contact').send(body);
      expect(blocked.status).toBe(429);

      await superuserPrisma.contactSubmission.deleteMany({
        where: { email: 'ratelimit@e2e.test' },
      });
    });
  });

  describe('Platform Admin — settings + leads', () => {
    it('forbids an unauthenticated caller', async () => {
      expect((await request(server()).get('/api/platform-admin/leads')).status).toBe(401);
      expect((await request(server()).get('/api/platform-admin/settings')).status).toBe(401);
    });

    it('lists the submitted lead', async () => {
      const res = await request(server())
        .get('/api/platform-admin/leads')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((r: any) => r.email === 'lead@e2e.test')).toBe(true);
    });

    it('round-trips the notify-recipient list and audits the change', async () => {
      const empty = await request(server())
        .get('/api/platform-admin/settings')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empty.status).toBe(200);

      const updated = await request(server())
        .patch('/api/platform-admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contactNotifyEmails: ['ops@lumenhrms.test', 'sales@lumenhrms.test'] });
      expect(updated.status).toBe(200);
      expect(updated.body.contactNotifyEmails).toEqual([
        'ops@lumenhrms.test',
        'sales@lumenhrms.test',
      ]);

      const reread = await request(server())
        .get('/api/platform-admin/settings')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(reread.body.contactNotifyEmails).toEqual([
        'ops@lumenhrms.test',
        'sales@lumenhrms.test',
      ]);

      const audit = await request(server())
        .get('/api/platform-admin/audit')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(audit.body.some((r: any) => r.action === 'platform_settings.updated')).toBe(true);
    });

    it('rejects an invalid email in the recipient list', async () => {
      const res = await request(server())
        .patch('/api/platform-admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contactNotifyEmails: ['not-an-email'] });
      expect(res.status).toBe(400);
    });
  });
});

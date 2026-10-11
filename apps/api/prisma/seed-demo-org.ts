/**
 * Seeds ONE extra tenant — "demo" (Zenith Labs) — with a ~40-person,
 * 5-level org for client demos of the org chart, leave approvals, etc.
 * Touches nothing outside that tenant, so it's safe to run against the
 * shared dev DB without disturbing the acme/beta/gamma data the team uses.
 *
 * Idempotent: re-running reuses the tenant, Firebase users and employees
 * (profile fields — phone, location, joining date, lifecycle — are
 * refreshed from the roster).
 *
 *   cd apps/api
 *   npx ts-node prisma/seed-demo-org.ts          # or: npm run prisma:seed-demo
 *
 * Env: DATABASE_URL (migration role), FIREBASE_PROJECT_ID /
 * FIREBASE_SERVICE_ACCOUNT_JSON — same as prisma/seed.ts. Optional
 * DEMO_EMAIL_DOMAIN (default `zenithlabs.test`) sets the work-email domain
 * shown on the org chart. Use a domain you control or a reserved test TLD:
 * every address becomes a real Firebase login.
 */
import { DEMO_PASSWORD, prisma, seedTenant } from './seed';
import { DEMO_ROSTER, DEMO_TENANT, demoEmail, demoPhone } from './demo-org-roster';

const domain = process.env.DEMO_EMAIL_DOMAIN ?? 'zenithlabs.test';

async function main() {
  const tenant = await seedTenant(
    DEMO_TENANT.name,
    DEMO_TENANT.subdomain,
    DEMO_ROSTER.map((p) => ({
      code: p.code,
      first: p.first,
      last: p.last,
      designation: p.designation,
      dept: p.dept,
      managerCode: p.managerCode,
      loginEmail: demoEmail(p, domain),
      role: p.role,
      phone: demoPhone(p.code),
      workLocation: p.location,
      dateOfJoining: new Date(`${p.joined}T00:00:00Z`),
      lifecycleState: p.lifecycle ?? 'CONFIRMED',
    })),
  );

  const login = (code: string) => demoEmail(DEMO_ROSTER.find((p) => p.code === code)!, domain);
  // eslint-disable-next-line no-console
  console.log(`
Demo tenant ready: ${tenant.name} -> subdomain "${tenant.subdomain}" (${DEMO_ROSTER.length} employees)

Password for every account: ${DEMO_PASSWORD}
  Company Admin (CEO, sees whole chart):   ${login('ZEN-001')}
  HR Manager (sees whole chart):           ${login('ZEN-019')}
  Line Manager (CTO, own subtree):         ${login('ZEN-002')}
  Employee:                                ${login('ZEN-004')}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

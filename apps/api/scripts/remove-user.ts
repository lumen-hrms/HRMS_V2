/**
 * Dev/testing helper: removes a tenant login by email so the address can be
 * reused (e.g. re-onboarding a tenant with the same Company Admin email,
 * which otherwise fails with "already registered with Firebase").
 *
 * Deletes, for the given email:
 *   - every `public.users` row in any tenant (the linked employee, if any,
 *     survives — `employees.user_id` is ON DELETE SET NULL), and
 *   - the Firebase Auth user (emails are global in Firebase).
 * The tenant itself and its audit/login history are left alone.
 *
 * Runs as the migration role (DATABASE_URL). RLS is FORCEd even for the
 * owner, so it sets `app.current_tenant_id` per tenant like the seed does.
 * Refuses to touch a platform admin account.
 *
 * Usage (from apps/api):
 *   npm run user:remove -- someone@example.com          # dry run
 *   npm run user:remove -- someone@example.com --yes    # actually delete
 */
import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const confirmed = args.includes('--yes');

if (!email || !email.includes('@')) {
  console.error('Usage: npm run user:remove -- <email> [--yes]');
  process.exit(1);
}

const prisma = new PrismaClient();

if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credential: serviceAccountJson
      ? admin.credential.cert(JSON.parse(serviceAccountJson))
      : admin.credential.applicationDefault(),
  });
}
const firebaseAuth = admin.auth();

async function findFirebaseUser(address: string) {
  try {
    return await firebaseAuth.getUserByEmail(address);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') return null;
    throw err;
  }
}

async function main(target: string) {
  const platformAdmin = await prisma.platformAdminUser.findFirst({
    where: { email: { equals: target, mode: 'insensitive' } },
  });
  if (platformAdmin) {
    throw new Error(`${target} is a platform admin — refusing to remove it with this script`);
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, subdomain: true } });

  const matches: { tenant: (typeof tenants)[number]; userId: string; role: string }[] = [];
  for (const tenant of tenants) {
    const users = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
      return tx.user.findMany({
        where: { tenantId: tenant.id, email: { equals: target, mode: 'insensitive' } },
        select: { id: true, role: true },
      });
    });
    for (const u of users) matches.push({ tenant, userId: u.id, role: u.role });
  }

  const fbUser = await findFirebaseUser(target);

  console.log(`\nEmail: ${target}`);
  if (matches.length === 0) console.log('  DB users: none');
  for (const m of matches) {
    console.log(`  DB user ${m.userId} — ${m.role} in "${m.tenant.name}" (${m.tenant.subdomain})`);
  }
  console.log(
    fbUser
      ? `  Firebase user ${fbUser.uid} (claims: ${JSON.stringify(fbUser.customClaims ?? {})})`
      : '  Firebase user: none',
  );

  if (matches.length === 0 && !fbUser) {
    console.log('\nNothing to remove.');
    return;
  }
  if (!confirmed) {
    console.log('\nDry run — re-run with --yes to delete the above.');
    return;
  }

  for (const m of matches) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${m.tenant.id}, true)`;
      await tx.user.delete({ where: { id: m.userId } });
    });
    console.log(`  deleted DB user ${m.userId} (${m.tenant.subdomain})`);
  }
  if (fbUser) {
    await firebaseAuth.deleteUser(fbUser.uid);
    console.log(`  deleted Firebase user ${fbUser.uid}`);
  }
  console.log('\nDone.');
}

main(email)
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

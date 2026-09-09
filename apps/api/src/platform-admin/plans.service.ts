import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type IsolationTier, type Plan } from '@prisma/client';
import { PlatformPrismaClientProvider } from '../prisma/platform-prisma-client.provider';
import { entitlementsForPlan, type SellablePlan } from './entitlements';

/** Fields a tenant's Subscription snapshots from a plan. */
export interface SubscriptionSnapshot {
  plan: SellablePlan;
  seats: number;
  enabledModules: string[];
  features: Prisma.InputJsonValue;
  /** Negotiated per-seat rate. Effective monthly = pricePerSeat * seats. */
  pricePerSeat: Prisma.Decimal;
  isolationTier: IsolationTier;
}

export interface UpdatePlanInput {
  name?: string;
  /** List price per seat per month. */
  listPricePerSeat?: number;
  currency?: string;
  seatsIncluded?: number;
  enabledModules?: string[];
  features?: Record<string, boolean>;
  isolationTier?: IsolationTier;
}

/**
 * The operator-editable plan catalog (`platform.plans`). Read/written from
 * the Platform Admin → Plans screen. `entitlements.ts` remains the seed
 * source and the fallback when a row is somehow missing.
 *
 * Editing a plan here NEVER touches a live Subscription — see
 * `snapshotFor()`, which is called only at tenant creation, explicit plan
 * change, and renewal.
 */
@Injectable()
export class PlansService {
  constructor(private readonly platformPrisma: PlatformPrismaClientProvider) {}

  list(): Promise<Plan[]> {
    return this.platformPrisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** With per-plan active tenant counts, for the Plans screen. */
  async listWithCounts(): Promise<(Plan & { tenantCount: number })[]> {
    const [plans, grouped] = await Promise.all([
      this.list(),
      this.platformPrisma.subscription.groupBy({ by: ['plan'], _count: { _all: true } }),
    ]);
    const byPlan = new Map(grouped.map((g) => [g.plan as string, g._count._all]));
    return plans.map((p) => ({ ...p, tenantCount: byPlan.get(p.key) ?? 0 }));
  }

  /**
   * Normalised plan record. Falls back to the code-side defaults
   * (entitlements.ts) if the DB row is missing — the system stays functional
   * even before the seed / migration data lands.
   */
  async get(key: SellablePlan): Promise<Plan> {
    const row = await this.platformPrisma.plan.findUnique({ where: { key } });
    if (row) return row;

    const ent = entitlementsForPlan(key);
    const defaultSeats: Record<SellablePlan, number> = {
      STARTER: 50,
      GROWTH: 200,
      ENTERPRISE: 500,
    };
    return {
      key,
      name: key.charAt(0) + key.slice(1).toLowerCase(),
      listPricePerSeat: new Prisma.Decimal(0),
      currency: 'INR',
      seatsIncluded: defaultSeats[key],
      enabledModules: ent.enabledModules,
      features: ent.features as unknown as Prisma.JsonValue,
      isolationTier: 'POOLED',
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Plan;
  }

  async update(key: string, input: UpdatePlanInput, actorEmail?: string): Promise<Plan> {
    const before = await this.platformPrisma.plan.findUnique({ where: { key } });
    if (!before) throw new NotFoundException(`Unknown plan: ${key}`);

    const updated = await this.platformPrisma.plan.update({
      where: { key },
      data: {
        name: input.name,
        listPricePerSeat:
          input.listPricePerSeat !== undefined
            ? new Prisma.Decimal(input.listPricePerSeat)
            : undefined,
        currency: input.currency,
        seatsIncluded: input.seatsIncluded,
        enabledModules: input.enabledModules,
        features:
          input.features !== undefined
            ? (input.features as unknown as Prisma.InputJsonValue)
            : undefined,
        isolationTier: input.isolationTier,
      },
    });

    // Editing the catalog is an operator action worth recording. It does NOT
    // change any live tenant (that's the snapshot model) — the audit note
    // says so.
    await this.platformPrisma.platformAuditLog
      .create({
        data: {
          actorEmail: actorEmail ?? 'unknown',
          action: 'plan.updated',
          targetType: 'plan',
          targetId: key,
          metadata: {
            plan: key,
            changed: Object.keys(input),
            note: 'Catalog edit — live tenants unaffected until plan change or renewal.',
          },
        },
      })
      .catch(() => undefined);

    return updated;
  }

  /**
   * The snapshot to write onto a Subscription at assign-time / plan change /
   * renewal.
   *   - `seatsOverride` (onboarding wizard, or the tenant's current seats on
   *     renewal) wins over the plan's default seat count.
   *   - `pricePerSeatOverride` is the negotiated rate: passed at onboarding
   *     (operator adjusts the list price for the deal) and at renewal (the
   *     existing negotiated rate carries over — it's the contract term). A
   *     plain plan change omits it, so the tenant resets to the list price.
   */
  async snapshotFor(
    key: SellablePlan,
    seatsOverride?: number,
    pricePerSeatOverride?: number,
  ): Promise<SubscriptionSnapshot> {
    const plan = await this.get(key);
    return {
      plan: key,
      seats: seatsOverride ?? plan.seatsIncluded,
      enabledModules: plan.enabledModules,
      features: plan.features as unknown as Prisma.InputJsonValue,
      pricePerSeat:
        pricePerSeatOverride !== undefined
          ? new Prisma.Decimal(pricePerSeatOverride)
          : plan.listPricePerSeat,
      isolationTier: plan.isolationTier,
    };
  }
}

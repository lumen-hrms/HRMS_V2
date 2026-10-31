import { teamRelations, type TeamRelation } from '../employees/team';
import { nextOccurrence } from './admin-insights.calc';

/**
 * Pure calculations behind the employee dashboard's team and company panels.
 * The service supplies the employee list and the clock so this stays testable.
 */

export interface TeamPerson {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  reportingManagerId: string | null;
  lifecycleState: string;
  dateOfJoining: Date | null;
}

/** People who are actually working: not yet to join, and not gone. */
const ACTIVE = new Set(['PROBATION', 'CONFIRMED', 'NOTICE_PERIOD', 'SUSPENDED']);
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

const fullName = (p: Pick<TeamPerson, 'firstName' | 'lastName'>) =>
  `${p.firstName} ${p.lastName}`.trim();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);

export type TeamMemberRelation = Exclude<TeamRelation, 'SELF'>;

export interface TeamMember {
  id: string;
  name: string;
  relation: TeamMemberRelation;
}

/** The caller's manager, plus counts and the member list (working people only) for the team panels. */
export function buildMyTeam(people: TeamPerson[], selfId: string) {
  const relations = teamRelations(people, selfId);
  const byId = new Map(people.map((p) => [p.id, p]));

  let manager: { id: string; name: string; designation: string | null } | null = null;
  let teammateCount = 0;
  let reportCount = 0;
  const members: TeamMember[] = [];
  for (const [id, relation] of relations) {
    const p = byId.get(id);
    if (!p || relation === 'SELF' || !ACTIVE.has(p.lifecycleState)) continue;
    members.push({ id, name: fullName(p), relation });
    if (relation === 'BOSS') manager = { id, name: fullName(p), designation: p.designation };
    else if (relation === 'TEAMMATE') teammateCount++;
    else reportCount++;
  }
  return { manager, teammateCount, reportCount, members };
}

/** Recent joiners and the next work anniversaries across the company — name, role and date only. */
export function computeCelebrations(people: TeamPerson[], today: Date) {
  const active = people.filter((p) => ACTIVE.has(p.lifecycleState));
  const ref = (p: TeamPerson) => ({ id: p.id, name: fullName(p), designation: p.designation });

  const windowStart = new Date(today.getTime() - WINDOW_DAYS * DAY_MS);
  const newJoiners = active
    .filter((p) => p.dateOfJoining && p.dateOfJoining > windowStart && p.dateOfJoining <= today)
    .sort((a, b) => b.dateOfJoining!.getTime() - a.dateOfJoining!.getTime())
    .slice(0, 5)
    .map((p) => ({ ...ref(p), date: iso(p.dateOfJoining!) }));

  const anniversaries = active
    .flatMap((p) => {
      if (!p.dateOfJoining) return [];
      const when = nextOccurrence(p.dateOfJoining, today);
      const daysUntil = daysBetween(today, when);
      const years = when.getUTCFullYear() - p.dateOfJoining.getUTCFullYear();
      return daysUntil <= WINDOW_DAYS && years >= 1 ? [{ p, when, daysUntil, years }] : [];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || fullName(a.p).localeCompare(fullName(b.p)))
    .slice(0, 6)
    .map(({ p, when, daysUntil, years }) => ({ ...ref(p), date: iso(when), daysUntil, years }));

  return { newJoiners, anniversaries };
}

/**
 * Approved leave of the caller's team, each person once per leave. Only
 * names and dates are exposed — never the leave type or reason.
 */
export function shapeTeamOnLeave(
  leaves: { employeeId: string; startDate: Date; endDate: Date; halfDay: boolean }[],
  members: TeamMember[],
  today: Date,
) {
  const byId = new Map(members.map((m) => [m.id, m]));
  return leaves
    .flatMap((l) => {
      const member = byId.get(l.employeeId);
      if (!member) return [];
      return [
        {
          id: member.id,
          name: member.name,
          relation: member.relation,
          from: iso(l.startDate),
          to: iso(l.endDate),
          halfDay: l.halfDay,
          onLeaveToday: l.startDate <= new Date(today.getTime() + DAY_MS - 1) && l.endDate >= today,
        },
      ];
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}

/**
 * "My team" — how everyone else relates to one employee. Shared by the
 * employee directory (the *My team* filter) and the dashboard, so both mean
 * the same thing:
 *  - `BOSS`      the person they report to (direct manager only)
 *  - `TEAMMATE`  others who report to that same manager
 *  - `REPORT`    everyone below them, direct or indirect
 *  - `SELF`      themselves
 * Anyone else has no entry in the map.
 */
export type TeamRelation = 'SELF' | 'BOSS' | 'TEAMMATE' | 'REPORT';

export function teamRelations(
  people: { id: string; reportingManagerId: string | null }[],
  selfId: string,
): Map<string, TeamRelation> {
  const relations = new Map<string, TeamRelation>([[selfId, 'SELF']]);
  const self = people.find((p) => p.id === selfId);
  if (!self) return relations;

  const reportsOf = new Map<string, string[]>();
  for (const p of people) {
    if (!p.reportingManagerId) continue;
    const list = reportsOf.get(p.reportingManagerId) ?? [];
    list.push(p.id);
    reportsOf.set(p.reportingManagerId, list);
  }

  // Boss first, so a corrupt reporting loop can't turn them into a "report".
  const bossId = self.reportingManagerId;
  if (bossId && bossId !== selfId && people.some((p) => p.id === bossId)) {
    relations.set(bossId, 'BOSS');
  }

  // Everyone below, any depth. `relations.has` doubles as the cycle guard.
  const queue = [...(reportsOf.get(selfId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (relations.has(id)) continue;
    relations.set(id, 'REPORT');
    queue.push(...(reportsOf.get(id) ?? []));
  }

  // Same manager, not yet classified. A person with no manager has no teammates.
  if (relations.get(bossId ?? '') === 'BOSS') {
    for (const id of reportsOf.get(bossId!) ?? []) {
      if (!relations.has(id)) relations.set(id, 'TEAMMATE');
    }
  }
  return relations;
}

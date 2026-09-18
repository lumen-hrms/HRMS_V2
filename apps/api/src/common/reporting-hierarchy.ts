/**
 * Cycle-safe BFS over an employee's full reporting subtree — the same
 * traversal `EmployeesService`'s private `subordinateIds()` uses for the
 * org chart / row-scoping (apps/api/src/employees/employees.service.ts). A
 * pure function over `{id, reportingManagerId}[]` (no DI) so Leave and
 * Attendance can reuse it without importing `EmployeesService` and
 * introducing a circular module dependency — see CLAUDE.md's note that
 * `LeaveService` already does direct Prisma access for the same reason.
 */
export function recursiveReportIds(
  employees: { id: string; reportingManagerId: string | null }[],
  managerId: string,
): Set<string> {
  const directReportsOf = new Map<string, string[]>();
  for (const e of employees) {
    if (!e.reportingManagerId) continue;
    const list = directReportsOf.get(e.reportingManagerId) ?? [];
    list.push(e.id);
    directReportsOf.set(e.reportingManagerId, list);
  }

  const result = new Set<string>();
  const queue = [...(directReportsOf.get(managerId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (result.has(id)) continue;
    result.add(id);
    queue.push(...(directReportsOf.get(id) ?? []));
  }
  return result;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorUserId: string | null;
  action: string;
  module: string | null;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditFilter {
  module?: string;
  action?: string;
  targetType?: string;
  q?: string;
  from?: string;
  to?: string;
}

/** `module` -> a short, human label for the filter dropdown / table pill. */
export const MODULE_LABELS: Record<string, string> = {
  'identity-access': 'Identity & Access',
  'employee-master': 'Employee Master',
  attendance: 'Attendance',
  documents: 'Documents',
};

export function moduleLabel(module: string | null): string {
  if (!module) return 'Unknown';
  return MODULE_LABELS[module] ?? module;
}

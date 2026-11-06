import * as React from 'react';
import type { SetupStatus } from '@/lib/setup';

export interface SetupStatusValue {
  /** null while loading (or signed out). */
  status: SetupStatus | null;
  refresh: () => Promise<void>;
}

export const SetupStatusContext = React.createContext<SetupStatusValue>({
  status: null,
  refresh: async () => {},
});

/** Company setup status for the signed-in workspace — provided by `SetupStatusProvider`. */
export function useSetupStatus() {
  return React.useContext(SetupStatusContext);
}

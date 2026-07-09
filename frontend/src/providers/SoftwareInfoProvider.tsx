'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { api } from '@/lib/api';
import type { SoftwareInfo } from '@/lib/software-info';

interface SoftwareInfoContextValue {
  info: SoftwareInfo | null;
  refresh: () => Promise<void>;
}

const SoftwareInfoContext = createContext<SoftwareInfoContextValue>({
  info: null,
  refresh: async () => {},
});

/**
 * Loads the global software-info singleton once and exposes it to the app shell
 * (brand tile) and the Cpanel editor. `refresh()` lets the editor push updates
 * live to the brand after a save.
 */
export function SoftwareInfoProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [info, setInfo] = useState<SoftwareInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<SoftwareInfo>('/software-info');
      setInfo(data);
    } catch {
      // ignore — the brand falls back to its defaults
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SoftwareInfoContext.Provider value={{ info, refresh }}>
      {children}
    </SoftwareInfoContext.Provider>
  );
}

export const useSoftwareInfo = () => useContext(SoftwareInfoContext);

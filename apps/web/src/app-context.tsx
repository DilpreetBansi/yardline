import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Client, User } from './api/client.ts';

interface AppState {
  client: Client;
  mode: 'demo' | 'server';
  user: User | null;
  setUser(u: User | null): void;
  toast(message: string, kind?: 'info' | 'error'): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

export function AppProvider({ client, children }: { client: Client; children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: 'info' | 'error' }[]>([]);
  const nextId = useRef(1);
  const qc = useQueryClient();

  const toast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const setUser = useCallback(
    (u: User | null) => {
      if (u && client.transport.setUser) client.transport.setUser(u.id);
      setUserState(u);
      qc.invalidateQueries();
    },
    [client, qc],
  );

  // Any change anywhere (another tab, the customer, another rep) refreshes what's on screen.
  useEffect(
    () =>
      client.transport.subscribe((e) => {
        if (e.quoteId === '*') {
          qc.invalidateQueries();
          return;
        }
        qc.invalidateQueries({ queryKey: ['quote', e.quoteId] });
        qc.invalidateQueries({ queryKey: ['quotes'] });
        qc.invalidateQueries({ queryKey: ['metrics'] });
        qc.invalidateQueries({ queryKey: ['shared'] });
        if (e.kind === 'ordered') {
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['catalog'] });
        }
      }),
    [client, qc],
  );

  const value = useMemo<AppState>(() => ({ client, mode: client.transport.mode, user, setUser, toast }), [client, user, setUser, toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Loads the signed-in user (server) or the demo persona. */
export function useCurrentUser() {
  const { client, setUser, user } = useApp();
  const q = useQuery({ queryKey: ['me'], queryFn: () => client.me(), retry: false, enabled: user === null });
  useEffect(() => {
    if (q.data && !user) setUser(q.data);
  }, [q.data, user, setUser]);
  return { user: user ?? q.data ?? null, loading: q.isLoading, error: q.error };
}

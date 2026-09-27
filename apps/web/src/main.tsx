import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Client } from './api/client.ts';
import { demoTransport, httpTransport } from './api/transport.ts';
import { App } from './App.tsx';
import { AppProvider } from './app-context.tsx';
import { Logo } from './components/ui.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 } },
});

function Shell({ client }: { client: Client }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider client={client}>
        <App />
      </AppProvider>
    </QueryClientProvider>
  );
}

/** The demo boots Postgres in a worker first; show what's happening while it does. */
function DemoBoot() {
  const [state, setState] = useState<{ client?: Client; message: string; error?: string }>({ message: 'Loading the app…' });
  useEffect(() => {
    const boot = demoTransport();
    boot.onProgress((message) => setState((s) => ({ ...s, message })));
    boot.ready.then(
      () => setState({ client: createClient(boot.transport), message: '' }),
      (e: Error) => setState({ message: '', error: e.message }),
    );
  }, []);
  if (state.client) return <Shell client={state.client} />;
  return (
    <div className="boot">
      <div className="boot-card">
        <Logo size={44} />
        <h1>Yardline</h1>
        {state.error ? (
          <p>
            The in-browser database couldn’t start: {state.error}. Try a current Chrome, Edge, Firefox or Safari.
          </p>
        ) : (
          <>
            <p style={{ marginBottom: 22 }}>{state.message}</p>
            <div className="spinner" />
            <p style={{ marginTop: 22, fontSize: 12.5 }}>First load downloads Postgres (WebAssembly, a few MB). After that it’s cached.</p>
          </>
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode>{import.meta.env.MODE === 'demo' ? <DemoBoot /> : <Shell client={createClient(httpTransport())} />}</StrictMode>);

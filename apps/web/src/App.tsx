import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useApp, useCurrentUser } from './app-context.tsx';
import { Logo } from './components/ui.tsx';
import { Layout } from './Layout.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { CatalogPage, OrderPage, OrdersPage } from './pages/Orders.tsx';
import { QuoteEditor } from './pages/QuoteEditor.tsx';
import { QuotesPage } from './pages/Quotes.tsx';
import { SharedQuote } from './pages/SharedQuote.tsx';

function StaffOnly() {
  const { mode } = useApp();
  const { user, loading } = useCurrentUser();
  const location = useLocation();
  if (loading) return <div className="main muted">Loading…</div>;
  if (!user) return mode === 'server' ? <Navigate to="/login" state={{ from: location.pathname }} replace /> : <div className="main">Could not load the demo user.</div>;
  return <Layout />;
}

function Login() {
  const { client, setUser } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('maya@yardline.test');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => client.login(email, password),
    onSuccess: (u) => {
      setUser(u);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    },
  });
  return (
    <div className="login">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div className="card-head">
          <div className="brand" style={{ color: 'var(--pine)', padding: 0 }}>
            <Logo />
            <div>Yardline</div>
          </div>
        </div>
        <div className="card-body">
          {login.error && <div className="banner error">{(login.error as Error).message}</div>}
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn primary" style={{ width: '100%' }} disabled={login.isPending}>
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}

export function App() {
  const { mode } = useApp();
  // GitHub Pages can't rewrite deep links, so the static demo uses hash URLs.
  const Router = mode === 'demo' ? HashRouter : BrowserRouter;
  return (
    <Router>
      <Routes>
        <Route path="/share/:token" element={<SharedQuote />} />
        {mode === 'server' && <Route path="/login" element={<Login />} />}
        <Route element={<StaffOnly />}>
          <Route index element={<Dashboard />} />
          <Route path="/quotes" element={<QuotesPage />} />
          <Route path="/quotes/:id" element={<QuoteEditor />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useApp } from './app-context.tsx';
import { Icon, Logo } from './components/ui.tsx';

const REPO = 'https://github.com/DilpreetBansi/yardline';

export function Layout() {
  const { client, mode, user, setUser, toast } = useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const users = useQuery({ queryKey: ['users'], queryFn: () => client.users(), enabled: mode === 'demo' });
  const counts = useQuery({ queryKey: ['metrics'], queryFn: () => client.metrics() });
  const openCount = counts.data ? counts.data.counts.draft + counts.data.counts.sent : 0;

  async function reset() {
    if (!client.transport.reset) return;
    toast('Resetting the demo database…');
    await client.transport.reset();
    await qc.invalidateQueries();
    navigate('/');
    toast('Demo data restored');
  }

  async function signOut() {
    await client.logout().catch(() => undefined);
    setUser(null);
    qc.clear();
    navigate('/login');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div>
            Yardline
            <small>Quotes &amp; orders</small>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            <Icon name="dashboard" />
            <span className="label">Dashboard</span>
          </NavLink>
          <NavLink to="/quotes">
            <Icon name="quotes" />
            <span className="label">Quotes</span>
            {openCount > 0 && <span className="count">{openCount}</span>}
          </NavLink>
          <NavLink to="/orders">
            <Icon name="orders" />
            <span className="label">Orders</span>
          </NavLink>
          <NavLink to="/catalog">
            <Icon name="catalog" />
            <span className="label">Catalog &amp; stock</span>
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          {mode === 'demo' ? (
            <>
              <div className="whoami">
                <label htmlFor="persona">Signed in as</label>
                <select
                  id="persona"
                  value={user?.id ?? ''}
                  onChange={(e) => {
                    const u = users.data?.find((x) => x.id === e.target.value);
                    if (u) {
                      setUser(u);
                      toast(`Now working as ${u.name} (${u.title})`);
                    }
                  }}
                >
                  {users.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.title}
                    </option>
                  ))}
                </select>
              </div>
              <p className="demo-note">
                Live demo: the API and a real Postgres run in your browser. Nothing leaves your machine.{' '}
                <button className="linkish" onClick={reset}>
                  Reset data
                </button>{' '}
                · <a href={REPO}>Source</a>
              </p>
            </>
          ) : (
            <div className="whoami">
              <label>Signed in</label>
              <div style={{ color: '#fff', fontWeight: 600 }}>{user?.name}</div>
              <button className="linkish" onClick={signOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

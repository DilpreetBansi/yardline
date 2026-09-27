import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useApp } from '../app-context.tsx';
import { StatusChip } from '../components/ui.tsx';
import { minutes, money, relTime } from '../lib/format.ts';
import { NewQuoteButton } from './Quotes.tsx';

export function Dashboard() {
  const { client, user, mode } = useApp();
  const navigate = useNavigate();
  const m = useQuery({ queryKey: ['metrics'], queryFn: () => client.metrics() });
  const quotes = useQuery({ queryKey: ['quotes', 'all', ''], queryFn: () => client.quotes() });

  const attention = (quotes.data ?? []).filter(
    (q) => (q.needsApproval && !q.approved && (q.status === 'draft' || q.status === 'sent')) || q.status === 'accepted',
  );
  const max = Math.max(1, ...(m.data?.daily ?? []).map((d) => d.created));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Good to see you{user ? `, ${user.name.split(' ')[0]}` : ''}</h1>
          <div className="sub">Quotes and orders across both yards, updated live.</div>
        </div>
        <NewQuoteButton />
      </div>

      <section className="kpis">
        <div className="card kpi">
          <div className="label">Open quotes</div>
          <div className="value num">{m.data ? m.data.counts.draft + m.data.counts.sent : '—'}</div>
          <div className="foot num">{money(m.data?.openValueCents)} in play</div>
        </div>
        <div className="card kpi">
          <div className="label">Won</div>
          <div className="value num">{money(m.data?.wonValueCents)}</div>
          <div className="foot num">{m.data ? `${m.data.counts.accepted + m.data.counts.ordered} quotes accepted or ordered` : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">Win rate</div>
          <div className="value num">{m.data?.winRate === null || !m.data ? '—' : `${Math.round(m.data.winRate * 100)}%`}</div>
          <div className="foot">of quotes the customer decided on</div>
        </div>
        <div className="card kpi">
          <div className="label">Time to send a quote</div>
          <div className="value num">{minutes(m.data?.minutesToSend.median)}</div>
          <div className="foot num">median, last 30 days · p90 {minutes(m.data?.minutesToSend.p90)}</div>
        </div>
      </section>

      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Needs attention</h2>
              <Link to="/quotes">All quotes →</Link>
            </div>
            {attention.length === 0 ? (
              <div className="empty">Nothing waiting on you.</div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {attention.slice(0, 8).map((q) => (
                      <tr key={q.id} className="link" onClick={() => navigate(`/quotes/${q.id}`)}>
                        <td>
                          <div className="strong">{q.customer.name}</div>
                          <div className="item-sub">
                            <span className="mono">{q.number}</span>
                            <span>{q.jobName}</span>
                          </div>
                        </td>
                        <td>
                          {q.status === 'accepted' ? (
                            <span className="chip accepted">Accepted: turn into an order</span>
                          ) : (
                            <span className="chip medium">Pricing needs a manager</span>
                          )}
                        </td>
                        <td className="right num hide-sm">{money(q.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Last two weeks</h2>
              <div className="legend">
                <span>
                  <i style={{ background: '#cfdcd4' }} />
                  Quotes created
                </span>
                <span>
                  <i style={{ background: 'var(--pine-3)' }} />
                  Accepted
                </span>
              </div>
            </div>
            <div className="card-body">
              <div className="bars" role="img" aria-label="Quotes created and accepted per day, last 14 days">
                {(m.data?.daily ?? []).map((d) => (
                  <div className="col" key={d.day} title={`${d.day}: ${d.created} created, ${d.won} accepted`}>
                    <div className="pair">
                      <div className="bar created" style={{ height: `${(d.created / max) * 100}%` }} />
                      <div className="bar won" style={{ height: `${(d.won / max) * 100}%` }} />
                    </div>
                    <div className="day">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric' })}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          {mode === 'demo' && (
            <div className="card tour">
              <div className="card-head">
                <h2>Try the whole flow</h2>
              </div>
              <div className="card-body">
                <ol>
                  <li>
                    <b>New quote</b>, pick a customer, then <b>paste a materials list</b> the way a contractor would text it.
                  </li>
                  <li>Check the matches, adjust quantities, and <b>save</b>. Pricing, tax and board feet update as you go.</li>
                  <li>
                    <b>Send to customer</b> and open the customer link <b>in a new tab</b>.
                  </li>
                  <li>Accept it there, and watch this tab update by itself.</li>
                  <li>
                    <b>Turn it into an order</b>: stock is reserved in the same transaction.
                  </li>
                </ol>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Switch to <b>Sam Okafor</b> (bottom left) to approve discounts past the rep limit.
                </p>
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <h2>Recent activity</h2>
            </div>
            <div className="table-wrap">
              <table className="data">
                <tbody>
                  {(quotes.data ?? []).slice(0, 7).map((q) => (
                    <tr key={q.id} className="link" onClick={() => navigate(`/quotes/${q.id}`)}>
                      <td>
                        <div className="strong">{q.customer.name}</div>
                        <div className="item-sub">{relTime(q.updatedAt)}</div>
                      </td>
                      <td className="right">
                        <StatusChip status={q.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

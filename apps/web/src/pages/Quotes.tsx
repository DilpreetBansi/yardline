import { useMutation, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useApp } from '../app-context.tsx';
import { Empty, Icon, Modal, StatusChip, TierBadge } from '../components/ui.tsx';
import { money, relTime } from '../lib/format.ts';

const TABS = [
  ['', 'All'],
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['accepted', 'Accepted'],
  ['ordered', 'Ordered'],
  ['declined', 'Declined'],
] as const;

export function QuotesPage() {
  const { client } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);
  const quotes = useQuery({ queryKey: ['quotes', status, q], queryFn: () => client.quotes({ status: status || undefined, q: q || undefined }) });
  const metrics = useQuery({ queryKey: ['metrics'], queryFn: () => client.metrics() });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Quotes</h1>
          <div className="sub">Every quote from both yards, newest activity first.</div>
        </div>
        <NewQuoteButton />
      </div>
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={status === key} className={status === key ? 'on' : ''} onClick={() => setParams(key ? { status: key } : {})}>
              {label}
              {key && metrics.data && <span className="n">{metrics.data.counts[key]}</span>}
            </button>
          ))}
        </div>
        <input className="input search" placeholder="Search customer, job or number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search quotes" />
      </div>
      <div className="card">
        {quotes.data && quotes.data.length === 0 ? (
          <Empty title="No quotes here">Try another tab or start a new quote.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Customer</th>
                  <th className="hide-sm">Job</th>
                  <th>Status</th>
                  <th className="right">Total</th>
                  <th className="hide-sm">Rep</th>
                  <th className="right hide-sm">Updated</th>
                </tr>
              </thead>
              <tbody>
                {(quotes.data ?? []).map((row) => (
                  <tr key={row.id} className="link" onClick={() => navigate(`/quotes/${row.id}`)}>
                    <td className="mono">{row.number}</td>
                    <td>
                      <div className="strong">{row.customer.name}</div>
                      <div className="item-sub">
                        <TierBadge tier={row.customer.tier} />
                        {row.needsApproval && !row.approved && <span className="chip medium plain">Needs approval</span>}
                      </div>
                    </td>
                    <td className="hide-sm">{row.jobName || <span className="muted">—</span>}</td>
                    <td>
                      <StatusChip status={row.status} />
                    </td>
                    <td className="right num strong">{money(row.totalCents)}</td>
                    <td className="hide-sm">{row.rep.name}</td>
                    <td className="right muted hide-sm nowrap">{relTime(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export function NewQuoteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>
        <Icon name="plus" /> New quote
      </button>
      {open && <NewQuoteModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NewQuoteModal({ onClose }: { onClose: () => void }) {
  const { client, toast } = useApp();
  const navigate = useNavigate();
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => client.customers() });
  const [customerId, setCustomerId] = useState('');
  const [jobName, setJobName] = useState('');
  const create = useMutation({
    mutationFn: () => client.createQuote(customerId, jobName.trim()),
    onSuccess: (q) => {
      toast(`Created ${q.number}`);
      navigate(`/quotes/${q.id}`);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const chosen = customers.data?.find((c) => c.id === customerId);
  return (
    <Modal
      title="New quote"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!customerId || create.isPending} onClick={() => create.mutate()}>
            Create quote
          </button>
        </>
      }
    >
      <label className="field">
        <span>Customer</span>
        <select className="select input" value={customerId} onChange={(e) => setCustomerId(e.target.value)} autoFocus>
          <option value="">Choose a customer…</option>
          {customers.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.tier})
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <p className="muted" style={{ marginTop: -6 }}>
          {chosen.contactName} · {chosen.email} · {chosen.tier === 'retail' ? 'retail pricing' : `${chosen.tier} pricing (${chosen.tier === 'pro' ? '12' : '8'}% off list)`}
        </p>
      )}
      <label className="field">
        <span>Job name</span>
        <input className="input" placeholder="e.g. Backyard deck, 16x20" value={jobName} maxLength={120} onChange={(e) => setJobName(e.target.value)} />
      </label>
    </Modal>
  );
}

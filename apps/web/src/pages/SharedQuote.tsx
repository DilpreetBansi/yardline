import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { HttpError } from '../api/client.ts';
import { useApp } from '../app-context.tsx';
import { Empty, Icon, Logo } from '../components/ui.tsx';
import { dateLong, money, pct, relTime, uomLabel } from '../lib/format.ts';

/** What the contractor sees from the link in their email. No sign-in; the token is the key. */
export function SharedQuote() {
  const { token = '' } = useParams();
  const { client, toast } = useApp();
  const qc = useQueryClient();
  const viewed = useRef(false);
  const shared = useQuery({
    queryKey: ['shared', token],
    queryFn: () => {
      const first = !viewed.current;
      viewed.current = true;
      return client.shared(token, first);
    },
    retry: false,
  });
  const q = shared.data;
  const [seenVersion, setSeenVersion] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  // The rep can still edit a sent quote. If they do, show it and make the customer look again.
  useEffect(() => {
    if (!q) return;
    if (seenVersion === null) setSeenVersion(q.version);
  }, [q, seenVersion]);
  const changed = q && seenVersion !== null && q.version !== seenVersion && q.status === 'sent';

  const accept = useMutation({
    mutationFn: () => client.accept(token, seenVersion ?? q!.version, name.trim()),
    onSuccess: (next) => {
      qc.setQueryData(['shared', token], next);
      toast('Thanks! Your rep has been notified.');
    },
    onError: (e: Error) => {
      if (e instanceof HttpError && e.code === 'version_conflict') qc.invalidateQueries({ queryKey: ['shared', token] });
      toast(e.message, 'error');
    },
  });
  const decline = useMutation({
    mutationFn: () => client.decline(token, reason.trim()),
    onSuccess: (next) => qc.setQueryData(['shared', token], next),
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (shared.isLoading) return <div className="customer muted">Loading your quote…</div>;
  if (shared.error || !q)
    return (
      <div className="customer">
        <Empty title="This link doesn’t work">{(shared.error as Error)?.message}</Empty>
      </div>
    );

  return (
    <div className="customer">
      <div className="letterhead">
        <div className="brand">
          <Logo size={36} />
          <div>
            Yardline Building Supply
            <small>{q.branch} · 905-555-0100</small>
          </div>
        </div>
        <button className="btn ghost no-print" onClick={() => window.print()}>
          <Icon name="print" /> Print or save as PDF
        </button>
      </div>

      {changed && (
        <div className="banner info no-print">
          <div className="grow">
            <strong>{q.rep.name} just updated this quote.</strong>
            The prices below are the latest. Take a look, then accept when you’re ready.
          </div>
          <button className="btn sm" onClick={() => setSeenVersion(q.version)}>
            Got it
          </button>
        </div>
      )}
      {q.status === 'accepted' || q.status === 'ordered' ? (
        <div className="banner ok">
          <div className="grow">
            <strong>
              Accepted by {q.acceptedByName} on {dateLong(q.acceptedAt)}
            </strong>
            {q.status === 'ordered' ? 'Your order is in and the material is set aside for you.' : `${q.rep.name} will confirm delivery details shortly.`}
          </div>
        </div>
      ) : q.status === 'declined' ? (
        <div className="banner error">
          <div className="grow">
            <strong>You declined this quote.</strong>
            Changed your mind? Reply to {q.rep.name} at {q.rep.email}.
          </div>
        </div>
      ) : q.expired ? (
        <div className="banner warn">
          <div className="grow">
            <strong>This quote has expired.</strong>
            Ask {q.rep.name} for updated pricing.
          </div>
        </div>
      ) : null}

      <div className="card doc">
        <h1>Quote {q.number}</h1>
        <div className="muted">
          Prepared for {q.customer.contact}, {q.customer.name}
          {q.jobName ? ` · ${q.jobName}` : ''}
        </div>
        <div className="meta">
          <div>
            <span>Issued</span>
            {dateLong(q.sentAt)}
          </div>
          <div>
            <span>Good until</span>
            {dateLong(q.validUntil)}
          </div>
          <div>
            <span>Your rep</span>
            {q.rep.name} · <a href={`mailto:${q.rep.email}`}>{q.rep.email}</a>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="right">Qty</th>
                <th className="right hide-sm">Your discount</th>
                <th className="right">Each</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {q.lines.map((l) => (
                <tr key={l.position}>
                  <td className="item-name">{l.name}</td>
                  <td className="right num nowrap">
                    {l.qty} {uomLabel(l.uom, l.qty)}
                  </td>
                  <td className="right num hide-sm">{l.discountBp ? pct(l.discountBp) : '—'}</td>
                  <td className="right num">{money(l.netUnitCents)}</td>
                  <td className="right num strong">{money(l.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <div className="totals" style={{ width: 300, padding: 0 }}>
            <div className="row">
              <span>Subtotal</span>
              <span className="num">{money(q.subtotalCents)}</span>
            </div>
            <div className="row">
              <span>HST 13%</span>
              <span className="num">{money(q.taxCents)}</span>
            </div>
            <div className="row total">
              <span>Total (CAD)</span>
              <span className="num">{money(q.totalCents)}</span>
            </div>
          </div>
        </div>

        {q.status === 'sent' && !q.expired && (
          <div className="no-print">
            {!declining ? (
              <div className="accept-box">
                <label className="field">
                  <span>Type your name to accept</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={q.customer.contact} maxLength={80} />
                </label>
                <button className="btn primary" disabled={name.trim().length < 2 || accept.isPending || !!changed} onClick={() => accept.mutate()} title={changed ? 'Review the update first' : undefined}>
                  <Icon name="check" /> Accept quote
                </button>
                <button className="btn ghost" onClick={() => setDeclining(true)}>
                  Decline
                </button>
              </div>
            ) : (
              <div className="accept-box">
                <label className="field">
                  <span>What should we know?</span>
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Job postponed" maxLength={500} />
                </label>
                <button className="btn danger" disabled={reason.trim().length < 2 || decline.isPending} onClick={() => decline.mutate()}>
                  Decline quote
                </button>
                <button className="btn ghost" onClick={() => setDeclining(false)}>
                  Back
                </button>
              </div>
            )}
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 20 }}>
          Prices in Canadian dollars. Updated {relTime(q.updatedAt)}. Delivery within the GTA is quoted separately.
        </p>
      </div>
    </div>
  );
}

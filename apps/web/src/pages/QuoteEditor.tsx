import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { HttpError, type LineSave, type Proposal, type QuoteDetail, type QuoteLine } from '../api/client.ts';
import { useApp } from '../app-context.tsx';
import { ConfidenceChip, Empty, Icon, Modal, StatusChip, TierBadge } from '../components/ui.tsx';
import { dateLong, dateTime, money, newKey, pct, relTime, uomLabel } from '../lib/format.ts';

const SAMPLES = [
  "PT 4x4x10 - 6\n2x8x12 pressure treated x 14\n2x6x16 PT x 30\n2x8 joist hangers (24)\n5 boxes 3\" deck screws\n10 bags concrete 30kg\n4x4 post base x 6",
  "2x4 studs 92-5/8 x 140\n1/2 drywall 4x8 x 90\n5/8 type x drywall 4x8 - 20 sheets\nR12 batts 10\ntwo rolls 6 mil poly\nconstruction adhesive x 12",
  "2x6-16' x 60\n40 2x4x8 SPF\n7/16 osb 4x8 x 64\n2x10 x 16 DF - 12\n3-1/4\" framing nails 30 lb x 2\nhurricane ties x40\nhouse wrap 1 roll",
];

interface DraftLine extends LineSave {
  key: string;
  name: string;
  uom: string;
  saved?: QuoteLine;
}

const q_tier = (bp: number) => (bp === 1200 ? 'pro tier' : bp === 800 ? 'contractor tier' : 'tier');

function toDraft(lines: QuoteLine[]): DraftLine[] {
  return lines.map((l) => ({ key: `${l.position}-${l.productId}`, productId: l.productId, qty: l.qty, extraDiscountBp: l.extraBp, rawText: l.rawText, name: l.name, uom: l.uom, saved: l }));
}

const EVENT_TEXT: Record<string, string> = {
  created: 'created the quote',
  lines_updated: 'saved changes',
  approved: 'approved the pricing',
  sent: 'sent it to the customer',
  viewed: 'opened the quote',
  accepted: 'accepted the quote',
  declined: 'declined the quote',
  ordered: 'turned it into an order',
};

export function QuoteEditor() {
  const { id = '' } = useParams();
  const { client, user, mode, toast } = useApp();
  const qc = useQueryClient();
  const quote = useQuery({ queryKey: ['quote', id], queryFn: () => client.quote(id) });
  const q = quote.data;

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [baseVersion, setBaseVersion] = useState(0);
  const [remoteChange, setRemoteChange] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const ourVersions = useRef(new Set<number>());

  // Server mode: open an SSE stream for this quote (the demo already gets every event).
  useEffect(() => {
    if (mode !== 'server') return;
    return client.transport.subscribe(() => qc.invalidateQueries({ queryKey: ['quote', id] }), id);
  }, [client, id, mode, qc]);

  // Take the server's lines whenever a new version arrives, unless the user is mid-edit.
  useEffect(() => {
    if (!q) return;
    if (q.version === baseVersion) return;
    const fromSomeoneElse = baseVersion !== 0 && !ourVersions.current.has(q.version);
    if (fromSomeoneElse) {
      const who = q.events[0]?.actor ?? 'Someone';
      const what = EVENT_TEXT[q.events[0]?.kind ?? ''] ?? 'changed this quote';
      if (dirty) {
        setRemoteChange(`${who} ${what} (now v${q.version}). Your unsaved edits are based on v${baseVersion}.`);
        return;
      }
      toast(`${who} ${what}`);
      setFlash((f) => f + 1);
    }
    setLines(toDraft(q.lines));
    setBaseVersion(q.version);
    setDirty(false);
    setRemoteChange(null);
  }, [q, baseVersion, dirty, toast]);

  const editable = q?.status === 'draft' || q?.status === 'sent';

  const save = useMutation({
    mutationFn: (next: DraftLine[]) =>
      client.saveLines(
        id,
        baseVersion,
        next.map(({ productId, qty, extraDiscountBp, rawText }) => ({ productId, qty, extraDiscountBp, rawText })),
      ),
    onSuccess: (saved) => {
      ourVersions.current.add(saved.version);
      qc.setQueryData(['quote', id], saved);
      setLines(toDraft(saved.lines));
      setBaseVersion(saved.version);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
    },
    onError: (e: Error) => {
      if (e instanceof HttpError && e.code === 'version_conflict') {
        setRemoteChange(`${e.message}`);
      } else {
        toast(e.message, 'error');
      }
    },
  });

  function update(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function remove(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
    setDirty(true);
  }
  function discardAndReload() {
    if (!q) return;
    setLines(toDraft(q.lines));
    setBaseVersion(q.version);
    setDirty(false);
    setRemoteChange(null);
    qc.invalidateQueries({ queryKey: ['quote', id] });
  }

  if (quote.isLoading) return <div className="muted">Loading…</div>;
  if (quote.error || !q) return <Empty title="Quote not found">{(quote.error as Error)?.message}</Empty>;

  const invalid = lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1);

  return (
    <>
      <div className="crumbs no-print">
        <Link to="/quotes">Quotes</Link> / {q.number}
      </div>
      <div className="page-head">
        <div>
          <h1>
            {q.customer.name} <TierBadge tier={q.customer.tier} />
          </h1>
          <div className="sub">
            <span className="mono">{q.number}</span> · {q.jobName || 'No job name'} · {q.branch.name} · rep {q.rep.name}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="live" title="Changes from other people and the customer appear here as they happen">
            Live · v{q.version}
          </span>
          <StatusChip status={q.status} />
        </div>
      </div>

      {remoteChange && (
        <div className="banner warn no-print">
          <div className="grow">
            <strong>This quote changed while you were editing.</strong>
            {remoteChange}
          </div>
          <button className="btn sm" onClick={discardAndReload}>
            Load the latest (discard mine)
          </button>
        </div>
      )}
      {q.status === 'declined' && (
        <div className="banner error">
          <div className="grow">
            <strong>Declined by the customer</strong>
            {q.declineReason}
          </div>
        </div>
      )}
      {q.status === 'accepted' && (
        <div className="banner ok">
          <div className="grow">
            <strong>
              Accepted by {q.acceptedByName} {relTime(q.acceptedAt)}
            </strong>
            Turn it into an order to reserve the stock at {q.branch.name}.
          </div>
        </div>
      )}

      <div className="editor">
        <div className="stack">
          {editable && <PasteBox quote={q} onAdd={(added) => save.mutate([...lines, ...added])} busy={save.isPending || dirty} />}

          <div className="card">
            <div className="card-head">
              <h2>
                Lines <span className="muted num">({lines.length})</span>
              </h2>
              {dirty && (
                <div style={{ display: 'flex', gap: 8 }} className="no-print">
                  <button className="btn sm ghost" onClick={discardAndReload}>
                    Discard
                  </button>
                  <button className="btn sm primary" disabled={save.isPending || invalid} onClick={() => save.mutate(lines)}>
                    {save.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              )}
            </div>
            {lines.length === 0 ? (
              <Empty title="No lines yet">Paste a materials list above to fill the quote.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="right">Qty</th>
                      <th className="right hide-sm hide-md">List</th>
                      <th className="right">Extra disc.</th>
                      <th className="right">Net each</th>
                      <th className="right">Line total</th>
                      <th className="right hide-sm">In stock</th>
                      <th className="no-print" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const s = l.saved;
                      const short = s && s.available !== null && l.qty > s.available;
                      return (
                        <tr key={l.key}>
                          <td className="item-col">
                            <div className="item-name">{l.name}</div>
                            <div className="item-sub">
                              <span className="mono">{l.productId}</span>
                              {l.rawText && (
                                <span className="raw" title="What the customer wrote">
                                  “{l.rawText}”
                                </span>
                              )}
                            </div>
                            {s && s.approvalReasons.length > 0 && (
                              <div className="item-sub" style={{ color: 'var(--amber-ink)' }}>
                                <Icon name="shield" /> {s.approvalReasons.join('; ')}
                              </div>
                            )}
                          </td>
                          <td className="right">
                            {editable ? (
                              <input
                                className="input qty num"
                                type="number"
                                min={1}
                                step={1}
                                value={Number.isNaN(l.qty) ? '' : l.qty}
                                aria-label={`Quantity of ${l.name}`}
                                onChange={(e) => update(l.key, { qty: Math.floor(Number(e.target.value)) })}
                              />
                            ) : (
                              <span className="num">{l.qty}</span>
                            )}
                            <div className="item-sub" style={{ justifyContent: 'flex-end' }}>
                              {uomLabel(l.uom, l.qty)}
                            </div>
                          </td>
                          <td className="right num hide-sm hide-md">{s ? money(s.listUnitCents) : '—'}</td>
                          <td className="right">
                            {editable ? (
                              <input
                                className="input pct num"
                                type="number"
                                min={0}
                                max={50}
                                step={0.5}
                                value={(l.extraDiscountBp ?? 0) / 100}
                                aria-label={`Extra discount on ${l.name}`}
                                onChange={(e) => update(l.key, { extraDiscountBp: Math.max(0, Math.min(5000, Math.round(Number(e.target.value) * 100))) })}
                              />
                            ) : (
                              <span className="num">{pct(l.extraDiscountBp ?? 0)}</span>
                            )}
                            {s && s.tierBp + s.volumeBp > 0 && (
                              <div
                                className="item-sub nowrap"
                                style={{ justifyContent: 'flex-end' }}
                                title={`Applied automatically: ${pct(s.tierBp)} ${q_tier(s.tierBp)}${s.volumeBp ? ` + ${pct(s.volumeBp)} volume break` : ''}`}
                              >
                                +{pct(s.tierBp + s.volumeBp)} auto
                              </div>
                            )}
                          </td>
                          <td className="right num">{s && !dirty ? money(s.netUnitCents) : <span className="muted">—</span>}</td>
                          <td className="right num strong">{s && !dirty ? money(s.lineTotalCents) : <span className="muted">—</span>}</td>
                          <td className={`right num hide-sm ${short ? 'stock-low' : ''}`}>
                            {s?.available ?? '—'}
                            {short && <div className="item-sub" style={{ justifyContent: 'flex-end', color: 'var(--red)' }}>short {l.qty - (s.available ?? 0)}</div>}
                          </td>
                          <td className="no-print">
                            {editable && (
                              <button className="icon-btn" onClick={() => remove(l.key)} aria-label={`Remove ${l.name}`}>
                                <Icon name="trash" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="side">
          <div className={`card totals ${flash ? 'flash' : ''}`} key={flash}>
            <div className="row">
              <span>Subtotal</span>
              <span className="num">{money(q.subtotalCents)}</span>
            </div>
            <div className="row">
              <span>HST 13%</span>
              <span className="num">{money(q.taxCents)}</span>
            </div>
            <div className="row total">
              <span>Total</span>
              <span className="num">{money(q.totalCents)}</span>
            </div>
            <div className="row">
              <span className="muted">Lumber</span>
              <span className="num muted">{q.boardFeet.toLocaleString('en-CA', { maximumFractionDigits: 0 })} board ft</span>
            </div>
            {dirty && <p className="muted" style={{ margin: '8px 0 0', fontSize: 12.5 }}>Unsaved changes. Totals update when you save.</p>}
          </div>
          <QuoteActions quote={q} dirty={dirty} />
          <div className="card">
            <div className="card-head">
              <h2>Activity</h2>
            </div>
            <ul className="timeline">
              {q.events.map((e) => (
                <li key={e.id}>
                  <span className={`dot ${e.kind}`} />
                  <div>
                    <b>{e.actor}</b> {EVENT_TEXT[e.kind] ?? e.kind}
                    {e.kind === 'lines_updated' && typeof e.detail.totalCents === 'number' && <> · {money(e.detail.totalCents as number)}</>}
                    <div className="when">
                      {dateTime(e.at)} · v{e.version}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {user && q.rep.id !== user.id && <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>This is {q.rep.name}’s quote; you can still edit it.</p>}
        </aside>
      </div>
    </>
  );
}

function PasteBox({ quote, onAdd, busy }: { quote: QuoteDetail; onAdd: (lines: DraftLine[]) => void; busy: boolean }) {
  const { client, toast } = useApp();
  const [open, setOpen] = useState(quote.lines.length === 0);
  const [text, setText] = useState('');
  const [proposals, setProposals] = useState<(Proposal & { pick: string; qtyEdit: number; include: boolean })[] | null>(null);
  const sample = useRef(0);
  const parse = useMutation({
    mutationFn: () => client.parse(text),
    onSuccess: (ps) =>
      setProposals(ps.map((p) => ({ ...p, pick: p.best?.id ?? p.candidates[0]?.product.id ?? '', qtyEdit: p.qty, include: p.best !== null }))),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const matched = proposals?.filter((p) => p.include && p.pick) ?? [];

  function add() {
    const added: DraftLine[] = matched.map((p, i) => {
      const product = p.candidates.find((c) => c.product.id === p.pick)?.product ?? p.best!;
      return { key: `new-${Date.now()}-${i}`, productId: product.id, qty: p.qtyEdit, extraDiscountBp: 0, rawText: p.raw, name: product.name, uom: product.uom };
    });
    onAdd(added);
    setProposals(null);
    setText('');
    setOpen(false);
  }

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0, none: 0 };
    for (const p of proposals ?? []) c[p.confidence]++;
    return c;
  }, [proposals]);

  if (!open) {
    return (
      <div className="card no-print">
        <div className="card-head" style={{ borderBottom: 0 }}>
          <h2>Add more from a list</h2>
          <button className="btn sm" onClick={() => setOpen(true)}>
            <Icon name="plus" /> Paste items
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card no-print">
      <div className="card-head">
        <h2>Paste a materials list</h2>
        <span className="muted hide-sm" style={{ fontSize: 12.5 }}>
          Any format: “40 2x4x8 SPF”, “2x6-16' x 24”, “hurricane ties x50”
        </span>
      </div>
      <div className="card-body">
        {!proposals ? (
          <>
            <textarea
              className="input"
              rows={7}
              placeholder={'40 2x4x8 SPF\n2x10 x 16 DF - 18\n12 sheets 1/2" plywood\n5 boxes 3" deck screws'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Materials list"
            />
            <div className="paste-foot">
              <button
                className="btn ghost sm"
                onClick={() => {
                  setText(SAMPLES[sample.current % SAMPLES.length]!);
                  sample.current++;
                }}
              >
                <Icon name="spark" /> Try a sample list
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {quote.lines.length > 0 && (
                  <button className="btn ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                )}
                <button className="btn primary" disabled={!text.trim() || parse.isPending} onClick={() => parse.mutate()}>
                  {parse.isPending ? 'Matching…' : 'Match to catalog'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {proposals.length} lines: {counts.high} sure, {counts.medium} to check, {counts.low} unsure, {counts.none} not found. Pick the right item where
              needed, fix quantities, then add.
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th />
                    <th>You pasted</th>
                    <th>Catalog item</th>
                    <th className="right">Qty</th>
                    <th>Match</th>
                    <th className="right hide-sm">In stock</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p, i) => {
                    const chosen = p.candidates.find((c) => c.product.id === p.pick)?.product;
                    const set = (patch: Partial<(typeof proposals)[number]>) => setProposals((ps) => ps!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <tr key={i}>
                        <td>
                          <input type="checkbox" checked={p.include} disabled={!p.pick || p.confidence === 'none'} onChange={(e) => set({ include: e.target.checked })} aria-label={`Include ${p.raw}`} />
                        </td>
                        <td className="mono" style={{ maxWidth: 220 }}>
                          {p.raw}
                          {p.notes.map((n) => (
                            <div key={n} className="item-sub" style={{ fontFamily: 'var(--font)' }}>
                              {n}
                            </div>
                          ))}
                        </td>
                        <td style={{ minWidth: 220 }}>
                          {p.candidates.length && p.confidence !== 'none' ? (
                            <select className="select input" value={p.pick} onChange={(e) => set({ pick: e.target.value, include: true })} aria-label={`Match for ${p.raw}`}>
                              {p.candidates.map((c) => (
                                <option key={c.product.id} value={c.product.id}>
                                  {c.product.name} · {money(c.product.priceCents)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="muted">Not in the catalog. Add it by hand or check the spelling.</span>
                          )}
                        </td>
                        <td className="right">
                          <input className="input qty num" type="number" min={1} value={p.qtyEdit} onChange={(e) => set({ qtyEdit: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label={`Quantity for ${p.raw}`} />
                        </td>
                        <td>
                          <ConfidenceChip level={p.confidence} />
                        </td>
                        <td className={`right num hide-sm ${chosen && chosen.available < p.qtyEdit ? 'stock-low' : ''}`}>{chosen ? chosen.available : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="paste-foot">
              <button className="btn ghost sm" onClick={() => setProposals(null)}>
                Back to the list
              </button>
              <button className="btn primary" disabled={!matched.length || busy} onClick={add} title={busy ? 'Save or discard your line edits first' : undefined}>
                Add {matched.length} line{matched.length === 1 ? '' : 's'} to {quote.number}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QuoteActions({ quote: q, dirty }: { quote: QuoteDetail; dirty: boolean }) {
  const { client, user, mode, toast } = useApp();
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const orderKey = useRef<string | null>(null);
  const refresh = (next?: QuoteDetail) => {
    if (next) qc.setQueryData(['quote', q.id], next);
    qc.invalidateQueries({ queryKey: ['quote', q.id] });
    qc.invalidateQueries({ queryKey: ['quotes'] });
    qc.invalidateQueries({ queryKey: ['metrics'] });
  };

  const send = useMutation({
    mutationFn: () => client.send(q.id, q.version),
    onSuccess: ({ token, quote }) => {
      refresh(quote);
      const base = `${location.origin}${import.meta.env.BASE_URL}`;
      setLink(mode === 'demo' ? `${base}#/share/${token}` : `${base}share/${token}`);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const approve = useMutation({
    mutationFn: () => client.approve(q.id, q.version),
    onSuccess: (next) => {
      refresh(next);
      toast('Pricing approved');
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const order = useMutation({
    mutationFn: () => {
      // One key per intent: retries of this click reuse it, so a flaky network can't double-order.
      orderKey.current ??= newKey(`order-${q.id}`);
      return client.order(q.id, orderKey.current);
    },
    onSuccess: ({ order: o }) => {
      orderKey.current = null;
      refresh();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['catalog'] });
      toast(`Order ${o.number} created; stock reserved`);
    },
    onError: (e: Error) => {
      if (e instanceof HttpError && e.code === 'insufficient_stock') {
        const short = (e.details?.short ?? []) as { name: string; needed: number; available: number }[];
        toast(`Not enough stock: ${short.map((s) => `${s.name} (need ${s.needed}, have ${s.available})`).join('; ')}`, 'error');
        orderKey.current = null;
      } else toast(e.message, 'error');
    },
  });

  const needsApproval = q.needsApproval && !q.approved;
  const canSend = (q.status === 'draft' || q.status === 'sent') && q.lines.length > 0 && !needsApproval && !dirty;

  return (
    <div className="card no-print">
      <div className="actions">
        {needsApproval && (
          <div className="banner warn" style={{ margin: 0 }}>
            <div className="grow">
              <strong>Needs a manager</strong>
              {user?.role === 'manager' ? 'Review the flagged lines, then approve.' : 'A discount is past the rep limit or under the margin floor. Ask Sam to approve.'}
            </div>
          </div>
        )}
        {needsApproval && user?.role === 'manager' && (
          <button className="btn primary" disabled={approve.isPending || dirty} onClick={() => approve.mutate()}>
            <Icon name="shield" /> Approve pricing (v{q.version})
          </button>
        )}
        {q.needsApproval && q.approved && q.approvedByName && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Pricing approved by {q.approvedByName}.</p>}
        {(q.status === 'draft' || q.status === 'sent') && (
          <button className={`btn ${q.status === 'draft' ? 'primary' : ''}`} disabled={!canSend || send.isPending} onClick={() => send.mutate()}>
            <Icon name="send" /> {q.status === 'sent' ? 'Re-send (new link)' : 'Send to customer'}
          </button>
        )}
        {q.status === 'sent' && (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Sent {relTime(q.sentAt)} · good until {dateLong(q.validUntil)}. Edits show up on the customer’s page right away.
          </p>
        )}
        {q.status === 'accepted' && (
          <button className="btn primary" disabled={order.isPending} onClick={() => order.mutate()}>
            <Icon name="truck" /> Turn into an order
          </button>
        )}
        {q.order && (
          <Link className="btn" to={`/orders/${q.order.id}`}>
            <Icon name="truck" /> Order {q.order.number}
          </Link>
        )}
        <button className="btn ghost" onClick={() => window.print()}>
          <Icon name="print" /> Print or save as PDF
        </button>
      </div>
      {link && (
        <Modal
          title="Quote sent"
          onClose={() => setLink(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setLink(null)}>
                Done
              </button>
              <a className="btn primary" href={link} target="_blank" rel="noreferrer">
                <Icon name="external" /> Open the customer’s view
              </a>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            In a real yard this link would go to <b>{q.customer.email}</b>. Open it in a new tab to act as the customer; this page updates live when they accept.
          </p>
          <div className="copy-row">
            <input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Customer link" />
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(link).then(
                  () => toast('Link copied'),
                  () => toast('Copy failed; select the link and copy it', 'error'),
                );
              }}
            >
              <Icon name="link" /> Copy
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>
            Only a fingerprint of this link is stored, so it can’t be shown again. Re-sending issues a new link and retires this one.
          </p>
        </Modal>
      )}
    </div>
  );
}

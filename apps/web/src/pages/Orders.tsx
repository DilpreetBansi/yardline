import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApp } from '../app-context.tsx';
import { Empty } from '../components/ui.tsx';
import { dateTime, money, relTime, uomLabel } from '../lib/format.ts';

export function OrdersPage() {
  const { client } = useApp();
  const navigate = useNavigate();
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => client.orders() });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <div className="sub">Accepted quotes turned into orders. Their stock is reserved at the yard.</div>
        </div>
      </div>
      <div className="card">
        {orders.data?.length === 0 ? (
          <Empty title="No orders yet">Accepted quotes show up here once you turn them into orders.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th className="hide-sm">From quote</th>
                  <th className="hide-sm">Yard</th>
                  <th className="right">Lines</th>
                  <th className="right">Total</th>
                  <th className="right hide-sm">Created</th>
                </tr>
              </thead>
              <tbody>
                {(orders.data ?? []).map((o) => (
                  <tr key={o.id} className="link" onClick={() => navigate(`/orders/${o.id}`)}>
                    <td className="mono">{o.number}</td>
                    <td className="strong">{o.customerName}</td>
                    <td className="mono hide-sm">{o.quoteNumber}</td>
                    <td className="hide-sm">{o.branchName}</td>
                    <td className="right num">{o.lineCount}</td>
                    <td className="right num strong">{money(o.totalCents)}</td>
                    <td className="right muted hide-sm">{relTime(o.createdAt)}</td>
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

export function OrderPage() {
  const { id = '' } = useParams();
  const { client } = useApp();
  const order = useQuery({ queryKey: ['orders', id], queryFn: () => client.orderDetail(id) });
  const o = order.data;
  if (order.isLoading) return <div className="muted">Loading…</div>;
  if (!o) return <Empty title="Order not found" />;
  return (
    <>
      <div className="crumbs">
        <Link to="/orders">Orders</Link> / {o.number}
      </div>
      <div className="page-head">
        <div>
          <h1>{o.customerName}</h1>
          <div className="sub">
            <span className="mono">{o.number}</span> · from <Link to={`/quotes/${o.quoteId}`}>{o.quoteNumber}</Link> · {o.branchName} · created by {o.createdBy},{' '}
            {dateTime(o.createdAt)}
          </div>
        </div>
        <span className="chip accepted">{o.status}</span>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="right">Qty</th>
                <th className="right">Each</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.position}>
                  <td>
                    <div className="item-name">{l.name}</div>
                    <div className="item-sub mono">{l.productId}</div>
                  </td>
                  <td className="right num">
                    {l.qty} {uomLabel(l.uom, l.qty)}
                  </td>
                  <td className="right num">{money(l.netUnitCents)}</td>
                  <td className="right num strong">{money(l.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
          <div>
            Total with HST <b className="num" style={{ fontSize: 18, marginLeft: 10 }}>{money(o.totalCents)}</b>
          </div>
        </div>
      </div>
    </>
  );
}

const CATEGORIES = [
  ['', 'All'],
  ['lumber', 'Lumber'],
  ['stud', 'Studs'],
  ['post', 'Posts'],
  ['sheet', 'Sheet goods'],
  ['drywall', 'Drywall'],
  ['fastener', 'Fasteners'],
  ['hardware', 'Hardware'],
  ['concrete', 'Concrete'],
  ['insulation', 'Insulation'],
  ['membrane', 'Wraps & poly'],
  ['adhesive', 'Adhesives'],
] as const;

export function CatalogPage() {
  const { client, user } = useApp();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const q = useDeferredValue(search);
  const items = useQuery({ queryKey: ['catalog', q, category], queryFn: () => client.catalog({ q: q || undefined, category: category || undefined }) });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalog &amp; stock</h1>
          <div className="sub">
            {items.data?.length ?? '…'} items · stock at your yard{user ? ` (${user.branchId === 'MSS' ? 'Mississauga' : 'Brampton'})` : ''}. Search is fuzzy (Postgres pg_trgm): try “doug fir 2x10”.
          </div>
        </div>
      </div>
      <div className="toolbar">
        <input className="input search" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
        <select className="select input" style={{ width: 180 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          {CATEGORIES.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="hide-sm">Category</th>
                <th className="right">Price</th>
                <th className="right">On hand</th>
                <th className="right hide-sm">Reserved</th>
                <th className="right">Available</th>
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="item-name">{p.name}</div>
                    <div className="item-sub mono">{p.id}</div>
                  </td>
                  <td className="hide-sm" style={{ textTransform: 'capitalize' }}>
                    {p.category}
                  </td>
                  <td className="right num nowrap">
                    {money(p.priceCents)} <span className="muted">/ {uomLabel(p.uom, 1)}</span>
                  </td>
                  <td className="right num">{p.onHand}</td>
                  <td className="right num hide-sm">{p.reserved || '—'}</td>
                  <td className={`right num strong ${p.available < 20 ? 'stock-low' : ''}`}>{p.available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

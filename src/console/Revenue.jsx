import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Empty, Field, Modal, Pill, Segmented } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { formatPrice } from '../lib/format.js'
import { useWorkspace } from '../workspace/context.js'
import { SectionHeader } from './Admin.jsx'

const INCOME_CATEGORIES = ['Subscriptions', 'Setup & training', 'Custom work', 'Investment', 'Other income']
const EXPENSE_CATEGORIES = ['Hosting & servers', 'Software & tools', 'Salaries', 'Marketing', 'Office & rent', 'Taxes & fees', 'Other expense']
const money = (value) => formatPrice(Math.round(value), 'NGN')
const short = (value) => value >= 1e6 ? `₦${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}m` : value >= 1e3 ? `₦${Math.round(value / 1e3)}k` : `₦${Math.round(value)}`
const monthName = (key, style = 'short') => new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: style, year: style === 'long' ? 'numeric' : undefined })
const todayKey = () => new Date().toISOString().slice(0, 10)

function RecordModal({ kind, organizations, onClose, onSaved }) {
  const { toast } = useWorkspace()
  const categories = kind === 'inflow' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setBusy(true)
    try {
      await api('/api/admin/ledger', { method: 'POST', body: { ...values, kind } })
      toast(kind === 'inflow' ? 'Income recorded' : 'Expense recorded')
      onSaved()
    } catch (error) {
      toast(error.message, 'error')
      setBusy(false)
    }
  }
  return (
    <Modal title={kind === 'inflow' ? 'Record income' : 'Record an expense'} eyebrow="Revenue" onClose={onClose} width={520} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="Amount (₦)"><input name="amount" type="number" min="0.01" step="0.01" required autoFocus placeholder="e.g. 45000" /></Field>
          <Field label="Date"><input name="occurredOn" type="date" required defaultValue={todayKey()} max={todayKey()} /></Field>
          <Field label="Category">
            <select name="category" defaultValue={categories[0]}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
          </Field>
          {kind === 'inflow' ? (
            <Field label="From workspace (optional)">
              <select name="organizationId" defaultValue=""><option value="">—</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            </Field>
          ) : <div />}
          <Field label="Description" wide><input name="description" maxLength={300} placeholder={kind === 'inflow' ? 'e.g. Bank transfer from ABC Properties' : 'e.g. Vercel Pro plan'} /></Field>
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon="check" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// Grouped monthly bars: money in (slot 1) beside money out (slot 2), one shared axis.
function MonthlyChart({ months }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...months.flatMap((month) => [month.inflow, month.outflow]))
  const step = 10 ** Math.floor(Math.log10(max))
  const top = Math.ceil(max / step) * step
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => top * ratio)
  return (
    <div className="rv-chart" onMouseLeave={() => setHover(null)}>
      <div className="rv-legend" aria-hidden="true">
        <span><i className="rv-swatch in" />Money in</span>
        <span><i className="rv-swatch out" />Money out</span>
      </div>
      <div className="rv-plot">
        <div className="rv-axis">{[...ticks].reverse().map((tick) => <span key={tick}>{short(tick)}</span>)}</div>
        <div className="rv-area">
          {ticks.map((tick) => <div key={tick} className="rv-grid" style={{ bottom: `${(tick / top) * 100}%` }} />)}
          <div className="rv-columns">
            {months.map((month, index) => (
              <button type="button" key={month.month} className={`rv-col${hover === index ? ' active' : ''}`}
                onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}
                aria-label={`${monthName(month.month, 'long')}: in ${money(month.inflow)}, out ${money(month.outflow)}, net ${money(month.inflow - month.outflow)}`}>
                <span className="rv-bars">
                  <i className="rv-bar in" style={{ height: `${(month.inflow / top) * 100}%` }} />
                  <i className="rv-bar out" style={{ height: `${(month.outflow / top) * 100}%` }} />
                </span>
                <span className="rv-month">{monthName(month.month)}</span>
                {hover === index && (
                  <span className={`rv-tip${index > months.length - 4 ? ' left' : ''}`} role="tooltip">
                    <strong>{monthName(month.month, 'long')}</strong>
                    <span><i className="rv-swatch in" />In <b>{money(month.inflow)}</b></span>
                    <span><i className="rv-swatch out" />Out <b>{money(month.outflow)}</b></span>
                    <span className="rv-tip-net">Net <b>{money(month.inflow - month.outflow)}</b></span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function RevenueSection() {
  const { toast } = useWorkspace()
  const [data, setData] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [organizations, setOrganizations] = useState([])
  const [recording, setRecording] = useState(null)
  const [view, setView] = useState('chart')
  const [filter, setFilter] = useState('all')

  const load = useCallback(() => {
    api('/api/admin/revenue').then(setData).catch((error) => toast(error.message, 'error'))
  }, [toast])
  useEffect(() => {
    load()
    api('/api/admin/organizations').then((result) => setOrganizations(result.organizations || [])).catch(() => {})
  }, [load])

  const remove = (entry) => setDeleting(entry)
  async function confirmDelete() {
    try {
      await api(`/api/admin/ledger/${deleting.id}`, { method: 'DELETE' })
      toast('Entry deleted')
      load()
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setDeleting(null)
    }
  }

  const totals = data?.totals
  const net = totals ? totals.inflowThisMonth - totals.outflowThisMonth : 0
  const change = totals && totals.inflowLastMonth ? Math.round(((totals.inflowThisMonth - totals.inflowLastMonth) / totals.inflowLastMonth) * 100) : null
  const rows = (data?.transactions || []).filter((entry) => filter === 'all' || entry.kind === filter)

  return (
    <div className="stack">
      <SectionHeader eyebrow="Business" title="Revenue" description="Money coming in and going out of OVO. Paystack payments appear automatically; record bank transfers and expenses yourself.">
        <Button icon="plus" onClick={() => setRecording('inflow')}>Record income</Button>
        <Button variant="primary" icon="plus" onClick={() => setRecording('outflow')}>Record expense</Button>
      </SectionHeader>
      {!data ? <div className="cx-skeleton"><span /><span /><span /></div> : <>
        <div className="rv-tiles">
          <div className="card rv-tile">
            <span className="rv-tile-label"><i className="rv-swatch in" />Money in · this month</span>
            <strong>{money(totals.inflowThisMonth)}</strong>
            <small>{change === null ? `Last month ${money(totals.inflowLastMonth)}` : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs last month`}</small>
          </div>
          <div className="card rv-tile">
            <span className="rv-tile-label"><i className="rv-swatch out" />Money out · this month</span>
            <strong>{money(totals.outflowThisMonth)}</strong>
            <small>Last month {money(totals.outflowLastMonth)}</small>
          </div>
          <div className="card rv-tile">
            <span className="rv-tile-label">Net · this month</span>
            <strong className={net < 0 ? 'negative' : ''}>{net < 0 ? '−' : ''}{money(Math.abs(net))}</strong>
            <small>{net >= 0 ? 'Profit' : 'Loss'} so far this month</small>
          </div>
          <div className="card rv-tile">
            <span className="rv-tile-label">Monthly recurring revenue</span>
            <strong>{money(data.mrr)}</strong>
            <small>{data.payingWorkspaces} paying {data.payingWorkspaces === 1 ? 'workspace' : 'workspaces'}</small>
          </div>
        </div>

        <section className="card rv-card">
          <div className="card-head">
            <div><h2>Last 12 months</h2><p>This year: {money(totals.inflowYear)} in · {money(totals.outflowYear)} out · net {money(totals.inflowYear - totals.outflowYear)}</p></div>
            <Segmented label="Show as" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
          </div>
          {view === 'chart' ? <MonthlyChart months={data.monthly} /> : (
            <div className="table-wrap"><table className="table cx-table">
              <thead><tr><th>Month</th><th>Money in</th><th>Money out</th><th>Net</th></tr></thead>
              <tbody>{[...data.monthly].reverse().map((month) => (
                <tr key={month.month}><td className="cell-strong">{monthName(month.month, 'long')}</td><td>{money(month.inflow)}</td><td>{money(month.outflow)}</td><td>{money(month.inflow - month.outflow)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>

        {data.categories.length > 0 && (
          <section className="card rv-card">
            <div className="card-head"><div><h2>This year by category</h2><p>Where money came from and where it went.</p></div></div>
            <div className="rv-cats">
              {['inflow', 'outflow'].map((kind) => {
                const items = data.categories.filter((item) => item.kind === kind)
                const biggest = Math.max(1, ...items.map((item) => item.total))
                return (
                  <div key={kind}>
                    <span className="rv-tile-label"><i className={`rv-swatch ${kind === 'inflow' ? 'in' : 'out'}`} />{kind === 'inflow' ? 'Money in' : 'Money out'}</span>
                    {!items.length ? <p className="muted-note">Nothing yet.</p> : items.map((item) => (
                      <div key={item.category} className="rv-cat">
                        <span>{item.category}</span>
                        <div className="rv-cat-track"><i className={kind === 'inflow' ? 'in' : 'out'} style={{ width: `${(item.total / biggest) * 100}%` }} /></div>
                        <b>{money(item.total)}</b>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section className="card rv-card">
          <div className="card-head">
            <div><h2>Transactions</h2><p>Newest first. Paystack payments are added automatically.</p></div>
            <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'inflow', label: 'Money in' }, { value: 'outflow', label: 'Money out' }]} />
          </div>
          {!rows.length ? <Empty icon="billing" title="No transactions yet">Payments through Paystack and anything you record will be listed here.</Empty> : (
            <div className="table-wrap"><table className="table cx-table">
              <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Details</th><th>Amount</th><th aria-label="Actions" /></tr></thead>
              <tbody>{rows.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted">{new Date(entry.occurredOn).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td><Pill tone={entry.kind === 'inflow' ? 'info' : 'warning'}>{entry.kind === 'inflow' ? 'In' : 'Out'}</Pill></td>
                  <td>{entry.category}</td>
                  <td>{entry.description || '—'}{entry.organization && <span className="muted"> · {entry.organization}</span>}</td>
                  <td className={`cell-strong rv-amount ${entry.kind}`}>{entry.kind === 'outflow' ? '−' : '+'}{money(entry.amount)}</td>
                  <td className="cell-actions">{entry.source === 'manual'
                    ? <button type="button" className="icon-btn" aria-label="Delete entry" onClick={() => remove(entry)}><Icon name="trash" size={16} /></button>
                    : <span className="muted rv-source">Paystack</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </>}
      {deleting && (
        <Modal title="Delete this entry?" onClose={() => setDeleting(null)} width={440}>
          <div className="modal-body"><p className="confirm-text">{deleting.category} · {money(deleting.amount)} on {new Date(deleting.occurredOn).toLocaleDateString()}. This can’t be undone.</p></div>
          <div className="modal-foot"><Button onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" icon="trash" onClick={confirmDelete}>Delete</Button></div>
        </Modal>
      )}
      {recording && <RecordModal kind={recording} organizations={organizations} onClose={() => setRecording(null)} onSaved={() => { setRecording(null); load() }} />}
    </div>
  )
}

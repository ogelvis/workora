import { useCallback, useEffect, useState } from 'react'
import ActivityChart from '../components/ActivityChart.jsx'
import Icon from '../components/Icon.jsx'
import { Avatar, Button, Empty, Field, Meter, Modal, Pill, copyText } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { capitalize, formatBytes, formatDateTime, formatPrice, timeAgo, toLocalInput } from '../lib/format.js'
import { useWorkspace } from '../workspace/context.js'
import { INDUSTRIES } from '../../shared/industries.js'

const statusTone = { trial: 'info', active: 'success', past_due: 'warning', cancelled: 'muted', expired: 'warning', suspended: 'danger' }
const statusLabel = { trial: 'Trial', active: 'Active', past_due: 'Past due', cancelled: 'Cancelled', expired: 'Expired', suspended: 'Suspended' }

function StatusPill({ organization }) {
  const trialEnded = organization.status === 'trial' && organization.trialEndsAt && new Date(organization.trialEndsAt) < new Date()
  return <Pill tone={trialEnded ? 'warning' : statusTone[organization.status]}>{trialEnded ? 'Trial ended' : statusLabel[organization.status] || '—'}</Pill>
}

function toIso(localValue) {
  return localValue ? new Date(localValue).toISOString() : null
}

function addDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalInput(date.toISOString())
}

// ---------------------------------------------------------------- Partner businesses

// What happened to the welcome email, with the link as a fallback to send by hand.
function LinkResult({ result, email }) {
  const { toast } = useWorkspace()
  return (
    <div className="stack-sm">
      {result.emailSent ? (
        <div className="notice notice-success"><Icon name="check" size={16} /><span>Welcome email sent to <strong>{email}</strong>. When they click the link, their dashboard opens straight away.</span></div>
      ) : (
        <div className="notice notice-warning"><Icon name="alert" size={16} /><span>The email wasn’t sent: {result.emailError} Copy the link below and send it to <strong>{email}</strong> yourself (WhatsApp or email).</span></div>
      )}
      <div className="link-box">
        <input readOnly value={result.link} onFocus={(event) => event.target.select()} aria-label="Sign-in link" />
        <Button variant="primary" icon="copy" onClick={async () => toast(await copyText(result.link) ? 'Link copied' : 'Copy the link manually')}>Copy</Button>
      </div>
      <p className="field-hint">The link works once and expires on {new Date(result.expiresAt).toLocaleDateString()}. Inside, they choose a password under Settings → Security.</p>
    </div>
  )
}

function AddPartner({ plans, onClose, onCreated }) {
  const { toast } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('active')
  const [result, setResult] = useState(null)
  const [emailReady, setEmailReady] = useState(null)

  useEffect(() => {
    api('/api/admin/email-status').then((data) => setEmailReady(data.configured)).catch(() => setEmailReady(false))
  }, [])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      const created = await api('/api/admin/partners', {
        method: 'POST',
        body: { ...values, status, paidUntil: status === 'active' && values.paidUntil ? new Date(`${values.paidUntil}T23:59:59`).toISOString() : null },
      })
      setResult({ ...created, email: values.email })
      onCreated()
      toast('Partner business added')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={result ? `${result.organization.name} is ready` : 'Add a partner business'} eyebrow="Super admin · Partners" onClose={onClose} width={640} busy={busy}>
      {result ? (
        <>
          <div className="modal-body"><LinkResult result={result} email={result.email} /></div>
          <div className="modal-foot"><Button variant="primary" onClick={onClose}>Done</Button></div>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="modal-body stack-sm">
            <p className="confirm-text">Creates the workspace and its owner account for them. They get an email with a one-time link that opens their dashboard directly — no sign-up or password needed to start.</p>
            {emailReady === false && (
              <div className="notice notice-warning"><Icon name="alert" size={16} /><span>Email sending isn’t set up yet, so you’ll get a link to send them yourself.</span></div>
            )}
            <div className="form-grid">
              <Field label="Business name"><input name="businessName" required minLength={2} maxLength={160} placeholder="e.g. ABC Properties Ltd" /></Field>
              <Field label="Business type">
                <select name="industry" defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {INDUSTRIES.map((industry) => <option key={industry.key} value={industry.label}>{industry.label}</option>)}
                </select>
              </Field>
              <Field label="Contact person"><input name="contactName" required minLength={2} maxLength={120} placeholder="Full name" /></Field>
              <Field label="Contact email" hint="The welcome link goes here"><input name="email" type="email" required /></Field>
              <Field label="Plan">
                <select name="plan" defaultValue={plans.find((plan) => plan.name === 'Business') ? 'Business' : plans[0]?.name}>
                  {plans.map((plan) => <option key={plan.name} value={plan.name}>{plan.name}</option>)}
                </select>
              </Field>
              <Field label="Access">
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="active">Active (partner / paid)</option>
                  <option value="trial">14-day trial</option>
                </select>
              </Field>
              {status === 'active' && <Field label="Paid until" hint="Optional. Leave empty for open-ended partner access."><input name="paidUntil" type="date" /></Field>}
              <Field label="Notes" hint="Agreement, contact, payment terms" wide><textarea name="billingNotes" rows={2} maxLength={2000} placeholder="Partner business added by OVO." /></Field>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
          <div className="modal-foot">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" icon="send" disabled={busy}>{busy ? 'Creating…' : 'Create & send welcome link'}</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- Workspace detail

function WorkspaceDetail({ id, plans, onClose, onChanged }) {
  const { account, toast } = useWorkspace()
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [linkResult, setLinkResult] = useState(null)

  async function sendLink() {
    setSaving(true)
    try {
      const result = await api(`/api/admin/organizations/${id}/welcome-link`, { method: 'POST' })
      setLinkResult(result)
      toast(result.emailSent ? 'Sign-in link emailed' : 'Link created — send it manually')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    api(`/api/admin/organizations/${id}`).then((result) => {
      setData(result)
      const org = result.organization
      setForm({
        plan: org.plan || 'Starter',
        status: org.status || 'trial',
        trialEndsAt: toLocalInput(org.trialEndsAt),
        currentPeriodEnd: toLocalInput(org.currentPeriodEnd),
        billingNotes: org.billingNotes || '',
      })
    }).catch((error) => toast(error.message, 'error'))
  }, [id, toast])

  function set(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save(overrides = {}) {
    const values = { ...form, ...overrides }
    setSaving(true)
    try {
      const result = await api(`/api/admin/organizations/${id}/subscription`, {
        method: 'PUT',
        body: { ...values, trialEndsAt: toIso(values.trialEndsAt), currentPeriodEnd: toIso(values.currentPeriodEnd) },
      })
      setData((current) => ({ ...current, organization: result.organization }))
      setForm(values)
      toast('Subscription updated')
      onChanged()
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    try {
      await api(`/api/admin/organizations/${id}`, { method: 'DELETE', body: { confirmName } })
      toast('Workspace deleted')
      onChanged()
      onClose()
    } catch (error) {
      toast(error.message, 'error')
      setSaving(false)
    }
  }

  const org = data?.organization
  const ownWorkspace = org?.id === account.organization.id

  return (
    <Modal title={org?.name || 'Workspace'} eyebrow="Super admin · Workspace" onClose={onClose} width={760} busy={saving}>
      {!org || !form ? <div className="modal-body"><div className="chart-skeleton" /></div> : (
        <>
          <div className="modal-body admin-detail">
            <div className="admin-facts">
              <div><span>Owner</span><strong>{org.ownerName || '—'}</strong><small>{org.ownerEmail}</small>{org.partner && <small>{org.ownerPasswordSet ? 'Password set' : org.ownerVerifiedAt ? 'Signed in · no password yet' : 'Hasn’t opened their link yet'}</small>}</div>
              <div><span>Status</span><StatusPill organization={org} /></div>
              <div><span>Members</span><strong>{org.members} / {org.userLimit >= 2147483647 ? '∞' : org.userLimit}</strong></div>
              <div><span>Storage</span><strong>{formatBytes(org.storageBytes)}</strong><small>of {formatBytes(org.storageLimitBytes)}</small></div>
              <div><span>Created</span><strong>{new Date(org.createdAt).toLocaleDateString()}</strong></div>
              <div><span>Last active</span><strong>{org.lastActiveAt ? timeAgo(org.lastActiveAt) : '—'}</strong></div>
            </div>

            {org.ownerId && (
              <section className="admin-section">
                <h3>Sign-in link {org.partner && <Pill tone="info">Partner</Pill>}</h3>
                <p className="muted-note">Email the owner a one-time link that opens their dashboard directly. Useful for partners who haven’t set a password, or anyone locked out.</p>
                {linkResult ? <LinkResult result={linkResult} email={org.ownerEmail} /> : (
                  <Button size="sm" icon="send" disabled={saving} onClick={sendLink}>Send sign-in link to {org.ownerEmail}</Button>
                )}
              </section>
            )}

            <section className="admin-section">
              <h3>Subscription</h3>
              <div className="quick-actions">
                <Button size="sm" icon="check" disabled={saving} onClick={() => save({ status: 'active', currentPeriodEnd: addDays(30) })}>Paid · 1 month</Button>
                <Button size="sm" icon="check" disabled={saving} onClick={() => save({ status: 'active', currentPeriodEnd: addDays(365) })}>Paid · 1 year</Button>
                <Button size="sm" icon="clock" disabled={saving} onClick={() => save({ status: 'trial', trialEndsAt: addDays(14) })}>Extend trial 14 days</Button>
                {form.status === 'suspended'
                  ? <Button size="sm" icon="shield" disabled={saving} onClick={() => save({ status: 'active' })}>Reactivate</Button>
                  : <Button size="sm" variant="danger" icon="alert" disabled={saving || ownWorkspace} onClick={() => save({ status: 'suspended' })}>Suspend</Button>}
              </div>
              <div className="form-grid">
                <Field label="Plan">
                  <select value={form.plan} onChange={(event) => set('plan', event.target.value)}>
                    {plans.map((plan) => <option key={plan.name} value={plan.name}>{plan.name}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={(event) => set('status', event.target.value)}>
                    {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Trial ends"><input type="datetime-local" value={form.trialEndsAt} onChange={(event) => set('trialEndsAt', event.target.value)} /></Field>
                <Field label="Paid until" hint="Set when you receive a payment"><input type="datetime-local" value={form.currentPeriodEnd} onChange={(event) => set('currentPeriodEnd', event.target.value)} /></Field>
                <Field label="Billing notes" hint="Payment references, agreements, contacts" wide>
                  <textarea rows={2} maxLength={2000} value={form.billingNotes} onChange={(event) => set('billingNotes', event.target.value)} />
                </Field>
              </div>
            </section>

            <section className="admin-section">
              <h3>Members</h3>
              <ul className="admin-list">
                {data.members.map((member) => (
                  <li key={member.id}>
                    <Avatar name={member.fullName} size="sm" />
                    <div><strong>{member.fullName}</strong><small>{member.email}</small></div>
                    <Pill>{capitalize(member.role)}</Pill>
                  </li>
                ))}
              </ul>
            </section>

            <section className="admin-section">
              <h3>Recent activity</h3>
              {data.activity.length ? (
                <ul className="admin-list compact">
                  {data.activity.map((entry) => (
                    <li key={entry.id}><div><span><strong>{entry.userName || 'Former member'}</strong> {entry.action} <strong>{entry.object}</strong></span><small>{timeAgo(entry.createdAt)}</small></div></li>
                  ))}
                </ul>
              ) : <p className="muted-note">No activity yet.</p>}
            </section>

            {!ownWorkspace && (
              <section className="admin-section danger-zone">
                <h3>Delete workspace</h3>
                {!deleting ? (
                  <>
                    <p>Permanently deletes this workspace with all of its projects, tasks, clients, files and chat. This cannot be undone.</p>
                    <Button variant="danger" size="sm" icon="trash" onClick={() => setDeleting(true)}>Delete workspace…</Button>
                  </>
                ) : (
                  <>
                    <p>Type <strong>{org.name}</strong> to confirm.</p>
                    <div className="link-box">
                      <input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} aria-label="Workspace name" />
                      <Button variant="danger" icon="trash" disabled={confirmName !== org.name || saving} onClick={remove}>Delete forever</Button>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
          <div className="modal-foot">
            <Button onClick={onClose} disabled={saving}>Close</Button>
            <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save subscription'}</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- Shared pieces

// Loads data for a section and keeps loading, error and retry in one place.
function useLoad(load, deps) {
  const { expired } = useWorkspace()
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const run = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await load()
      setState({ data, error: null, loading: false })
    } catch (error) {
      if (error.status === 401) expired()
      setState((current) => ({ ...current, error, loading: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, reload: run }
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="cx-error">
      <span className="empty-icon"><Icon name="alert" size={20} /></span>
      <div><strong>This section didn’t load</strong><p>{error?.message || 'Something went wrong.'}</p></div>
      <Button icon="clock" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function Skeleton({ rows = 3 }) {
  return <div className="cx-skeleton">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>
}

export function SectionHeader({ eyebrow, title, description, children }) {
  return (
    <header className="cx-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="cx-head-actions">{children}</div>}
    </header>
  )
}

const attentionInfo = {
  payment: { label: 'Payment overdue', tone: 'rose', icon: 'alert' },
  trial_ended: { label: 'Trial ended', tone: 'amber', icon: 'clock' },
  trial_ending: { label: 'Trial ends soon', tone: 'amber', icon: 'clock' },
  paid_lapsed: { label: 'Paid period ended', tone: 'rose', icon: 'billing' },
  paid_ending: { label: 'Renewal due soon', tone: 'blue', icon: 'billing' },
  partner_pending: { label: 'Partner hasn’t signed in', tone: 'violet', icon: 'send' },
}

function attentionDate(row) {
  const date = ['paid_lapsed', 'paid_ending'].includes(row.reason) ? row.currentPeriodEnd : ['trial_ended', 'trial_ending'].includes(row.reason) ? row.trialEndsAt : null
  return date ? new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

// ---------------------------------------------------------------- Overview

export function OverviewSection({ go, onAddPartner }) {
  const { account } = useWorkspace()
  const { data, error, reload } = useLoad(() => api('/api/admin/overview'), [])
  const [openId, setOpenId] = useState(null)
  const [plans, setPlans] = useState([])
  useEffect(() => { api('/api/admin/plans').then((result) => setPlans(result.plans)).catch(() => {}) }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="stack">
      <section className="cx-hero">
        <div>
          <span className="cx-hero-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <h1>{greeting}, {account.user.fullName.split(' ')[0]}</h1>
          <p>Here’s how OVO is doing today.</p>
        </div>
        <div className="cx-hero-actions">
          <button type="button" onClick={onAddPartner}><Icon name="plus" size={16} />Add partner business</button>
          <button type="button" onClick={() => go('workspaces')}><Icon name="building" size={16} />All workspaces</button>
          <button type="button" onClick={() => go('plans')}><Icon name="billing" size={16} />Pricing</button>
        </div>
      </section>

      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton rows={4} /> : (() => {
        const { totals } = data
        const maxPlan = Math.max(1, ...data.byPlan.map((row) => row.count))
        return (
          <>
            <section className="cx-kpis">
              <button type="button" className="cx-kpi tone-violet" onClick={() => go('workspaces')}>
                <span className="cx-kpi-icon"><Icon name="building" size={18} /></span>
                <strong>{totals.workspaces}</strong><span>Workspaces</span><small>{totals.newLast30Days} new in 30 days</small>
              </button>
              <button type="button" className="cx-kpi tone-green" onClick={() => go('workspaces', { status: 'active' })}>
                <span className="cx-kpi-icon"><Icon name="check" size={18} /></span>
                <strong>{totals.paying}</strong><span>Active & paying</span><small>{totals.activeTrials} on trial · {totals.endedTrials} trial ended</small>
              </button>
              <div className="cx-kpi tone-amber">
                <span className="cx-kpi-icon"><Icon name="money" size={18} /></span>
                <strong>{formatPrice(totals.mrr, totals.currency || 'NGN')}</strong><span>Monthly recurring revenue</span><small>From active plans</small>
              </div>
              <button type="button" className="cx-kpi tone-pink" onClick={() => go('partners')}>
                <span className="cx-kpi-icon"><Icon name="deal" size={18} /></span>
                <strong>{totals.partners}</strong><span>Partner businesses</span><small>Added by you</small>
              </button>
              <button type="button" className="cx-kpi tone-blue" onClick={() => go('users')}>
                <span className="cx-kpi-icon"><Icon name="team" size={18} /></span>
                <strong>{totals.users}</strong><span>People</span><small>{(totals.records || 0).toLocaleString()} records · {formatBytes(totals.storageBytes)}</small>
              </button>
              {totals.suspended > 0 && (
                <button type="button" className="cx-kpi tone-rose" onClick={() => go('workspaces', { status: 'suspended' })}>
                  <span className="cx-kpi-icon"><Icon name="shield" size={18} /></span>
                  <strong>{totals.suspended}</strong><span>Suspended</span><small>Locked out until reactivated</small>
                </button>
              )}
            </section>

            <section className="cx-grid">
              <div className="card cx-span-2">
                <div className="card-head"><div><h2>New workspaces</h2><p>Sign-ups per week, last 12 weeks.</p></div></div>
                <ActivityChart weeks={data.weeklySignups} unit="sign-ups" />
              </div>
              <div className="card">
                <div className="card-head"><div><h2>Plans</h2><p>Workspaces and revenue by plan.</p></div></div>
                <ul className="cx-bars">
                  {data.byPlan.map((row) => (
                    <li key={row.plan}>
                      <div><strong>{row.plan}</strong><span>{row.count} {row.count === 1 ? "workspace" : "workspaces"} · {row.active} active</span></div>
                      <div className="cx-bar"><i style={{ width: `${(row.count / maxPlan) * 100}%` }} /></div>
                      <small>{formatPrice(row.revenue, totals.currency || 'NGN')} / month</small>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="cx-grid">
              <div className="card cx-span-2">
                <div className="card-head"><div><h2>Needs your attention</h2><p>Trials ending, renewals due, unpaid accounts and partners who haven’t signed in.</p></div></div>
                {data.attention.length ? (
                  <ul className="cx-attention">
                    {data.attention.map((row) => {
                      const info = attentionInfo[row.reason]
                      return (
                        <li key={`${row.id}-${row.reason}`}>
                          <button type="button" onClick={() => setOpenId(row.id)}>
                            <span className={`create-icon tone-${info.tone}`}><Icon name={info.icon} size={15} /></span>
                            <span><strong>{row.name}{row.partner && <span className="partner-tag">Partner</span>}</strong><small>{info.label}{attentionDate(row) ? ` · ${attentionDate(row)}` : ''}</small></span>
                            <Icon name="right" size={14} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : <div className="cx-allclear"><Icon name="check" size={18} />All clear. Nothing needs action right now.</div>}
              </div>
              <div className="card">
                <div className="card-head"><div><h2>Recent actions</h2></div><button type="button" className="text-link" onClick={() => go('audit')}>Audit log <Icon name="right" size={14} /></button></div>
                {data.recentAudit.length ? (
                  <ul className="admin-list compact">
                    {data.recentAudit.map((entry) => (
                      <li key={entry.id}><div><span>{capitalize(entry.action)} <strong>{entry.targetName}</strong></span><small>{timeAgo(entry.createdAt)}</small></div></li>
                    ))}
                  </ul>
                ) : <p className="muted-note">Everything you do here is recorded.</p>}
              </div>
            </section>
          </>
        )
      })()}
      {openId && <WorkspaceDetail id={openId} plans={plans} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  )
}

// ---------------------------------------------------------------- Workspaces & partners

export function WorkspacesSection({ partnersOnly = false, onAddPartner, refreshKey }) {
  const { params } = useWorkspace()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState(params.status || '')
  const [openId, setOpenId] = useState(null)
  const [plans, setPlans] = useState([])

  useEffect(() => { api('/api/admin/plans').then((result) => setPlans(result.plans)).catch(() => {}) }, [])
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const { data, error, reload } = useLoad(() => {
    const search = new URLSearchParams()
    if (debounced) search.set('q', debounced)
    if (status) search.set('status', status)
    if (partnersOnly) search.set('partner', '1')
    return api(`/api/admin/organizations?${search}`).then((result) => result.organizations)
  }, [debounced, status, partnersOnly, refreshKey])

  return (
    <div className="stack">
      <SectionHeader
        eyebrow={partnersOnly ? 'Growth' : 'Customers'}
        title={partnersOnly ? 'Partner businesses' : 'Workspaces'}
        description={partnersOnly ? 'Businesses you set up yourself. Send them a sign-in link any time.' : 'Every business on OVO, with plan, payment and usage.'}
      >
        <Button variant="primary" icon="plus" onClick={onAddPartner}>Add partner business</Button>
      </SectionHeader>
      <div className="cx-toolbar">
        <label className="ws-search admin-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by business, email or owner…" aria-label="Search workspaces" />
        </label>
        <select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {data && <span className="cx-count">{data.length} {data.length === 1 ? 'workspace' : 'workspaces'}</span>}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton rows={5} /> : !data.length ? (
        <Empty icon={partnersOnly ? 'deal' : 'building'} title={partnersOnly ? 'No partner businesses yet' : 'No workspaces found'}
          action={partnersOnly && <Button variant="primary" icon="plus" onClick={onAddPartner}>Add partner business</Button>}>
          {partnersOnly ? 'Add a business and OVO emails its owner a link that opens their dashboard directly.' : 'Try a different search or status.'}
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table cx-table">
            <thead><tr><th>Business</th><th>Owner</th><th>Plan</th><th>Status</th><th>Members</th><th>Storage</th><th>Created</th></tr></thead>
            <tbody>
              {data.map((org) => (
                <tr key={org.id} onClick={() => setOpenId(org.id)} className="cx-row">
                  <td>
                    <div className="client-cell">
                      <Avatar name={org.name} size="sm" />
                      <div className="two-line"><strong>{org.name}{org.partner && <span className="partner-tag">Partner</span>}</strong><span>{org.industry || org.businessEmail}</span></div>
                    </div>
                  </td>
                  <td><div className="two-line"><span className="cell-strong">{org.ownerName || '—'}</span><span>{org.ownerEmail}</span></div></td>
                  <td>{org.plan || '—'}</td>
                  <td><StatusPill organization={org} />{org.currentPeriodEnd && org.status === 'active' && <div className="cell-sub">until {new Date(org.currentPeriodEnd).toLocaleDateString()}</div>}</td>
                  <td>{org.members}</td>
                  <td><div className="cell-meter"><span>{formatBytes(org.storageBytes)}</span><Meter value={org.storageBytes} max={org.storageLimitBytes || 1} /></div></td>
                  <td className="muted">{timeAgo(org.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <WorkspaceDetail id={openId} plans={plans} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  )
}

export { AddPartner }

// ---------------------------------------------------------------- Users

export function UsersSection() {
  const { toast } = useWorkspace()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [link, setLink] = useState(null)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])
  const { data, error, reload } = useLoad(
    () => api(`/api/admin/users${debounced ? `?${new URLSearchParams({ q: debounced })}` : ''}`).then((result) => result.users),
    [debounced],
  )

  async function resetLink(user) {
    try {
      const result = await api(`/api/admin/users/${user.id}/reset-link`, { method: 'POST' })
      setLink({ user, link: result.link })
    } catch (requestError) {
      toast(requestError.message, 'error')
    }
  }

  return (
    <div className="stack">
      <SectionHeader eyebrow="Customers" title="People" description="Everyone with an OVO account. Create a password-reset link for anyone who’s locked out." />
      <div className="cx-toolbar">
        <label className="ws-search admin-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or workspace…" aria-label="Search people" />
        </label>
        {data && <span className="cx-count">{data.length} {data.length === 1 ? 'person' : 'people'}</span>}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton rows={5} /> : !data.length ? <Empty icon="team" title="No one found">Try a different search.</Empty> : (
        <div className="card table-card">
          <table className="table cx-table">
            <thead><tr><th>Person</th><th>Workspace</th><th>Role</th><th>Last sign-in</th><th>Joined</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.map((user) => (
                <tr key={`${user.id}-${user.organizationId}`}>
                  <td><div className="client-cell"><Avatar name={user.fullName} size="sm" /><div className="two-line"><strong>{user.fullName}</strong><span>{user.email}</span></div></div></td>
                  <td>{user.organizationName || <span className="muted">No workspace</span>}</td>
                  <td>{user.role ? <Pill>{capitalize(user.role)}</Pill> : '—'}</td>
                  <td className="muted">{user.lastSignInAt ? timeAgo(user.lastSignInAt) : 'Never'}</td>
                  <td className="muted">{timeAgo(user.createdAt)}</td>
                  <td className="cell-actions"><Button size="sm" icon="key" onClick={() => resetLink(user)}>Reset link</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {link && (
        <Modal title={`Password reset for ${link.user.fullName}`} onClose={() => setLink(null)} width={520}>
          <div className="modal-body">
            <p className="confirm-text">Send this link to {link.user.email}. It works once and expires in 24 hours.</p>
            <div className="link-box">
              <input readOnly value={link.link} onFocus={(event) => event.target.select()} aria-label="Reset link" />
              <Button variant="primary" icon="copy" onClick={async () => toast(await copyText(link.link) ? 'Link copied' : 'Copy the link manually')}>Copy</Button>
            </div>
          </div>
          <div className="modal-foot"><Button onClick={() => setLink(null)}>Done</Button></div>
        </Modal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Plans

function PlanCard({ plan, onSaved }) {
  const { toast } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const unlimitedUsers = plan.userLimit >= 2147483647

  async function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setBusy(true)
    try {
      await api(`/api/admin/plans/${encodeURIComponent(plan.name)}`, {
        method: 'PUT',
        body: {
          userLimit: values.unlimitedUsers ? 2147483647 : Number(values.userLimit),
          storageLimitGb: Number(values.storageLimitGb),
          projectLimit: values.projectLimit ? Number(values.projectLimit) : null,
          monthlyPrice: values.monthlyPrice === '' ? null : Number(values.monthlyPrice),
          yearlyPrice: values.yearlyPrice === '' ? null : Number(values.yearlyPrice),
          currency: values.currency,
          active: values.active === 'on',
        },
      })
      toast(`${plan.name} plan saved`)
      onSaved()
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card plan-editor" onSubmit={submit}>
      <div className="card-head">
        <div><h2>{plan.name}</h2><p>{plan.workspaces} {plan.workspaces === 1 ? 'workspace' : 'workspaces'} on this plan</p></div>
        <label className="toggle"><input type="checkbox" name="active" defaultChecked={plan.active} /> Offered</label>
      </div>
      <fieldset className="form-grid" disabled={busy}>
        <Field label="Monthly price" hint="Leave empty for “Contact us”"><input name="monthlyPrice" type="number" min="0" step="1" defaultValue={plan.monthlyPrice ?? ''} /></Field>
        <Field label="Yearly price"><input name="yearlyPrice" type="number" min="0" step="1" defaultValue={plan.yearlyPrice ?? ''} /></Field>
        <Field label="Currency"><input name="currency" maxLength={3} defaultValue={plan.currency} /></Field>
        <Field label="Storage (GB)"><input name="storageLimitGb" type="number" min="0.1" step="0.1" defaultValue={Math.round((plan.storageLimitBytes / 1024 ** 3) * 10) / 10} /></Field>
        <Field label="Member limit">
          <input name="userLimit" type="number" min="1" defaultValue={unlimitedUsers ? 1000 : plan.userLimit} />
        </Field>
        <Field label="Project limit" hint="Empty = unlimited"><input name="projectLimit" type="number" min="1" defaultValue={plan.projectLimit ?? ''} /></Field>
        <label className="toggle field-wide"><input type="checkbox" name="unlimitedUsers" defaultChecked={unlimitedUsers} /> Unlimited members</label>
      </fieldset>
      <div className="card-foot">
        <span className="plan-preview">{plan.monthlyPrice !== null ? `${formatPrice(plan.monthlyPrice, plan.currency)} / month` : 'Shown as “Contact us”'}</span>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
      </div>
    </form>
  )
}

export function PlansSection() {
  const { data, error, reload } = useLoad(() => api('/api/admin/plans').then((result) => result.plans), [])
  return (
    <div className="stack">
      <SectionHeader eyebrow="Revenue" title="Plans & pricing" description="Prices appear on the landing page and every workspace’s Billing page. Limits apply to all workspaces on a plan immediately." />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton rows={4} /> : (
        <div className="plans-admin">{data.map((plan) => <PlanCard key={plan.name} plan={plan} onSaved={reload} />)}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Audit

export function AuditSection() {
  const { data, error, reload } = useLoad(() => api('/api/admin/audit').then((result) => result.entries), [])
  return (
    <div className="stack">
      <SectionHeader eyebrow="Security" title="Audit log" description="Every change made in this console, newest first." />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton rows={6} /> : !data.length ? (
        <Empty icon="shield" title="No actions yet">Every change made in this console is recorded here.</Empty>
      ) : (
        <div className="card table-card">
          <table className="table cx-table">
            <thead><tr><th>When</th><th>Action</th><th>Target</th><th>By</th></tr></thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted">{formatDateTime(entry.createdAt)}</td>
                  <td className="cell-strong">{capitalize(entry.action)}</td>
                  <td>{entry.targetName || '—'} <span className="muted">· {entry.targetType}</span></td>
                  <td className="muted">{entry.adminEmail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Account & security

export function AccountSection() {
  const { account, toast } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const sessions = useLoad(() => api('/api/auth/sessions').then((result) => result.sessions), [])

  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (values.newPassword !== values.confirmPassword) { toast('The new passwords don’t match.', 'error'); return }
    setBusy(true)
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: values.currentPassword, newPassword: values.newPassword } })
      form.reset()
      sessions.reload()
      toast('Password changed. Other devices were signed out.')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function signOutOthers() {
    try {
      await api('/api/auth/sessions/revoke-others', { method: 'POST' })
      sessions.reload()
      toast('Signed out everywhere else')
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  return (
    <div className="stack">
      <SectionHeader eyebrow="You" title="Account & security" description="Your owner sign-in, password and active sessions." />
      <div className="cx-grid">
        <div className="card cx-profile">
          <Avatar name={account.user.fullName} size="lg" />
          <div><strong>{account.user.fullName}</strong><span>{account.user.email}</span><Pill tone="info">Platform owner</Pill></div>
          <ul className="cx-facts">
            <li><Icon name="shield" size={15} />Signed in through your private address</li>
            <li><Icon name="clock" size={15} />Owner sessions last 30 days</li>
            <li><Icon name="key" size={15} />Forgot your password? Use “Forgot password” on the sign-in page.</li>
          </ul>
        </div>
        <form className="card settings-card cx-span-2" onSubmit={submit}>
          <div className="card-head"><div><h2>Change password</h2><p>At least 12 characters. Other devices are signed out.</p></div></div>
          <fieldset disabled={busy} className="form-grid">
            <Field label="Current password" wide><input name="currentPassword" type="password" required autoComplete="current-password" /></Field>
            <Field label="New password"><input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></Field>
            <Field label="Confirm new password"><input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></Field>
          </fieldset>
          <div className="card-foot"><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</Button></div>
        </form>
      </div>
      <div className="card">
        <div className="card-head">
          <div><h2>Active sessions</h2><p>Places where you’re signed in.</p></div>
          <Button size="sm" icon="logout" onClick={signOutOthers}>Sign out other sessions</Button>
        </div>
        {sessions.error ? <ErrorState error={sessions.error} onRetry={sessions.reload} /> : !sessions.data ? <Skeleton rows={2} /> : (
          <ul className="session-list">
            {sessions.data.map((session) => (
              <li key={session.id}>
                <span className="empty-icon small"><Icon name="shield" size={16} /></span>
                <div><strong>{session.current ? 'This device' : 'Another device'}</strong><small>Started {formatDateTime(session.createdAt)} · expires {formatDateTime(session.expiresAt)}</small></div>
                {session.current && <Pill tone="success">Current</Pill>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- System

function Check({ ok, warn, title, children }) {
  const tone = ok ? 'success' : warn ? 'warning' : 'danger'
  return (
    <li className={`cx-check cx-check-${tone}`}>
      <span className="cx-check-icon"><Icon name={ok ? 'check' : 'alert'} size={15} /></span>
      <div><strong>{title}</strong><p>{children}</p></div>
    </li>
  )
}

export function SystemSection() {
  const { data, error, reload } = useLoad(() => api('/api/admin/system'), [])
  return (
    <div className="stack">
      <SectionHeader eyebrow="Platform" title="System status" description="What’s set up, and what still needs doing.">
        <Button icon="clock" onClick={reload}>Re-check</Button>
      </SectionHeader>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton rows={5} /> : (
        <ul className="cx-checks card">
          <Check ok={data.database.connected && data.database.pendingMigrations?.length === 0} warn={data.database.pendingMigrations === null} title="Database">
            {data.database.pendingMigrations?.length
              ? <>Connected, but these updates haven’t been run yet: <b>{data.database.pendingMigrations.join(', ')}</b>. Run <code>npm run db:migrate</code> with the Production DATABASE_URL.</>
              : 'Connected and up to date.'}
          </Check>
          <Check ok={data.email.configured && Boolean(data.email.from)} warn title="Email sending">
            {data.email.configured
              ? <>Sending through {data.email.provider} as <b>{data.email.from || 'EMAIL_FROM not set'}</b>. Partner welcome links and password resets are emailed automatically.</>
              : <>Not set up. Partner links show in the console for you to send by hand, and password recovery needs the command line. Add <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> in Vercel, then redeploy.</>}
          </Check>
          <Check ok={data.payments?.paystack && data.payments.mode === 'live'} warn title="Online payments (Paystack)">
            {!data.payments?.paystack
              ? <>Not set up. Workspaces see “request a plan” buttons instead of checkout. Add <code>PAYSTACK_SECRET_KEY</code> in Vercel, then redeploy.</>
              : data.payments.mode === 'live'
                ? 'Live. Workspaces can pay by card, bank transfer or USSD, and plans activate automatically.'
                : <>Connected in <b>test mode</b> — no real money moves. Switch to your <code>sk_live_</code> key when you’re ready to take payments.</>}
          </Check>
          <Check ok={data.owners.count > 0} title="Owner access">
            {data.owners.count} owner {data.owners.count === 1 ? 'address' : 'addresses'} in <code>PLATFORM_ADMIN_EMAILS</code>.
          </Check>
          <Check ok={data.console.pathSet} title="Private console address">{data.console.pathSet ? 'Set. Only people who know the address can reach this sign-in.' : 'ADMIN_PATH is not set.'}</Check>
          <Check ok={Boolean(data.supportEmail)} warn title="Support email">
            {data.supportEmail ? <>Customers’ upgrade requests go to <b>{data.supportEmail}</b>.</> : <>Set <code>SUPPORT_EMAIL</code> in Vercel so the Billing page can show where to reach you.</>}
          </Check>
        </ul>
      )}
    </div>
  )
}

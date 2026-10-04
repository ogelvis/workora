import { useCallback, useEffect, useState } from 'react'
import ActivityChart from '../components/ActivityChart.jsx'
import Icon from '../components/Icon.jsx'
import { Avatar, Button, Empty, Field, Meter, Modal, PageHeader, Pill, Segmented, copyText } from '../components/ui.jsx'
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

// ---------------------------------------------------------------- Tabs

function OverviewTab() {
  const { toast } = useWorkspace()
  const [data, setData] = useState(null)
  useEffect(() => {
    api('/api/admin/overview').then(setData).catch((error) => toast(error.message, 'error'))
  }, [toast])
  if (!data) return <div className="card chart-skeleton" />
  const { totals } = data
  return (
    <div className="stack">
      <section className="stat-grid">
        <div className="stat-tile"><span className="stat-label">Workspaces</span><strong className="stat-value">{totals.workspaces}</strong><span className="stat-note">{totals.newLast30Days} new in 30 days</span></div>
        <div className="stat-tile"><span className="stat-label">Paying</span><strong className="stat-value">{totals.paying}</strong><span className="stat-note">{totals.activeTrials} on trial · {totals.endedTrials} trial ended</span></div>
        <div className="stat-tile"><span className="stat-label">Monthly recurring revenue</span><strong className="stat-value">{formatPrice(totals.mrr, totals.currency || 'NGN')}</strong><span className="stat-note">From active plans</span></div>
        <div className="stat-tile"><span className="stat-label">Users</span><strong className="stat-value">{totals.users}</strong><span className="stat-note">{formatBytes(totals.storageBytes)} stored</span></div>
      </section>
      <section className="grid-2-1">
        <div className="card">
          <div className="card-head"><div><h2>New workspaces</h2><p>Sign-ups per week over the last 12 weeks.</p></div></div>
          <ActivityChart weeks={data.weeklySignups} unit="sign-ups" />
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Plans</h2><p>Workspaces on each plan.</p></div></div>
          <ul className="admin-list">
            {data.byPlan.map((row) => (
              <li key={row.plan}><div><strong>{row.plan}</strong></div><span className="count-chip">{row.count}</span></li>
            ))}
          </ul>
          {totals.suspended > 0 && <p className="muted-note">{totals.suspended} suspended</p>}
        </div>
      </section>
      <section className="card">
        <div className="card-head"><div><h2>Recent admin actions</h2></div></div>
        {data.recentAudit.length ? (
          <ul className="admin-list compact">
            {data.recentAudit.map((entry) => (
              <li key={entry.id}><div><span><strong>{entry.adminEmail}</strong> {entry.action} <strong>{entry.targetName}</strong></span><small>{timeAgo(entry.createdAt)}</small></div></li>
            ))}
          </ul>
        ) : <p className="muted-note">Actions you take in this console are recorded here.</p>}
      </section>
    </div>
  )
}

function WorkspacesTab({ plans }) {
  const { toast } = useWorkspace()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [organizations, setOrganizations] = useState(null)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (status) params.set('status', status)
    const result = await api(`/api/admin/organizations?${params}`)
    setOrganizations(result.organizations)
  }, [query, status])

  useEffect(() => {
    const timer = setTimeout(() => load().catch((error) => toast(error.message, 'error')), 250)
    return () => clearTimeout(timer)
  }, [load, toast])

  return (
    <div className="stack">
      <div className="toolbar-row">
        <label className="ws-search admin-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by workspace, email or owner…" aria-label="Search workspaces" />
        </label>
        <select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add partner business</Button>
      </div>
      {organizations && !organizations.length ? <Empty icon="building" title="No workspaces found">Try a different search.</Empty> : (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Workspace</th><th>Owner</th><th>Plan</th><th>Status</th><th>Members</th><th>Storage</th><th>Created</th></tr></thead>
            <tbody>
              {(organizations || []).map((org) => (
                <tr key={org.id}>
                  <td>
                    <button type="button" className="client-cell" onClick={() => setOpenId(org.id)}>
                      <Avatar name={org.name} size="sm" />
                      <div className="two-line"><strong>{org.name}{org.partner && <span className="partner-tag">Partner</span>}</strong><span>{org.businessEmail}</span></div>
                    </button>
                  </td>
                  <td><div className="two-line"><span className="cell-strong">{org.ownerName || '—'}</span><span>{org.ownerEmail}</span></div></td>
                  <td>{org.plan}</td>
                  <td><StatusPill organization={org} />{org.currentPeriodEnd && org.status === 'active' && <div className="cell-sub">until {new Date(org.currentPeriodEnd).toLocaleDateString()}</div>}</td>
                  <td>{org.members}</td>
                  <td>
                    <div className="cell-meter">
                      <span>{formatBytes(org.storageBytes)}</span>
                      <Meter value={org.storageBytes} max={org.storageLimitBytes || 1} />
                    </div>
                  </td>
                  <td className="muted">{timeAgo(org.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddPartner plans={plans} onClose={() => setAdding(false)} onCreated={() => load().catch(() => {})} />}
      {openId && <WorkspaceDetail id={openId} plans={plans} onClose={() => setOpenId(null)} onChanged={() => load().catch(() => {})} />}
    </div>
  )
}

function UsersTab() {
  const { toast } = useWorkspace()
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState(null)
  const [link, setLink] = useState(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = query.trim() ? `?${new URLSearchParams({ q: query.trim() })}` : ''
      api(`/api/admin/users${params}`).then((result) => setUsers(result.users)).catch((error) => toast(error.message, 'error'))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, toast])

  async function resetLink(user) {
    try {
      const result = await api(`/api/admin/users/${user.id}/reset-link`, { method: 'POST' })
      setLink({ user, link: result.link })
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  return (
    <div className="stack">
      <label className="ws-search admin-search">
        <Icon name="search" size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or workspace…" aria-label="Search users" />
      </label>
      <div className="card table-card">
        <table className="table">
          <thead><tr><th>User</th><th>Workspace</th><th>Role</th><th>Last sign-in</th><th>Joined</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {(users || []).map((user) => (
              <tr key={`${user.id}-${user.organizationId}`}>
                <td><div className="client-cell"><Avatar name={user.fullName} size="sm" /><div className="two-line"><strong>{user.fullName}</strong><span>{user.email}</span></div></div></td>
                <td>{user.organizationName || <span className="muted">No workspace</span>}</td>
                <td>{user.role ? capitalize(user.role) : '—'}</td>
                <td className="muted">{user.lastSignInAt ? timeAgo(user.lastSignInAt) : 'Never'}</td>
                <td className="muted">{timeAgo(user.createdAt)}</td>
                <td className="cell-actions"><Button size="sm" icon="key" onClick={() => resetLink(user)}>Reset link</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {users && !users.length && <p className="muted-note pad">No users found.</p>}
      </div>
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

function PlansTab({ plans, reloadPlans }) {
  return (
    <div className="stack">
      <div className="notice">
        <Icon name="alert" size={16} />
        <span>Prices show on the landing page and in every workspace’s Billing page. Limits apply to all workspaces on the plan immediately.</span>
      </div>
      <div className="plans-admin">
        {plans.map((plan) => <PlanCard key={plan.name} plan={plan} onSaved={reloadPlans} />)}
      </div>
    </div>
  )
}

function AuditTab() {
  const { toast } = useWorkspace()
  const [entries, setEntries] = useState(null)
  useEffect(() => {
    api('/api/admin/audit').then((result) => setEntries(result.entries)).catch((error) => toast(error.message, 'error'))
  }, [toast])
  if (entries && !entries.length) return <Empty icon="shield" title="No admin actions yet">Every change made in this console is recorded here.</Empty>
  return (
    <div className="card table-card">
      <table className="table">
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>
          {(entries || []).map((entry) => (
            <tr key={entry.id}>
              <td className="muted">{formatDateTime(entry.createdAt)}</td>
              <td>{entry.adminEmail}</td>
              <td className="cell-strong">{capitalize(entry.action)}</td>
              <td>{entry.targetName} <span className="muted">· {entry.targetType}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Admin() {
  const { params, navigate, toast } = useWorkspace()
  const [plans, setPlans] = useState([])
  const tab = ['overview', 'workspaces', 'users', 'plans', 'audit'].includes(params.tab) ? params.tab : 'overview'

  const reloadPlans = useCallback(() => {
    api('/api/admin/plans').then((result) => setPlans(result.plans)).catch((error) => toast(error.message, 'error'))
  }, [toast])

  useEffect(() => {
    reloadPlans()
  }, [reloadPlans])

  return (
    <div className="stack">
      <PageHeader eyebrow="Platform / Super admin" title="OVO console" description="Every workspace on OVO: plans, payments, users and access.">
        <span className="vault-badge"><Icon name="shield" size={15} /> Platform admin</span>
      </PageHeader>
      <Segmented label="Console sections" value={tab} onChange={(next) => navigate('admin', { tab: next })} options={[
        { value: 'overview', label: 'Overview', icon: 'overview' },
        { value: 'workspaces', label: 'Workspaces', icon: 'building' },
        { value: 'users', label: 'Users', icon: 'team' },
        { value: 'plans', label: 'Plans & pricing', icon: 'billing' },
        { value: 'audit', label: 'Audit log', icon: 'list' },
      ]} />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'workspaces' && <WorkspacesTab plans={plans} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'plans' && <PlansTab plans={plans} reloadPlans={reloadPlans} />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

export default Admin

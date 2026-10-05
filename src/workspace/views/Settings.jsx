import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Field, IconButton, Menu, Modal, PageHeader, Pill, Segmented, copyText } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { capitalize, formatDateTime, timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'
import { INDUSTRIES, findIndustry } from '../../../shared/industries.js'

const roleInfo = {
  owner: 'Full control, including billing and admins.',
  admin: 'Manages the team, billing, vault and all work.',
  manager: 'Creates and assigns projects, tasks, clients and campaigns.',
  staff: 'Works on assigned tasks, files, chat and calendar.',
}

function LinkModal({ title, description, link, onClose }) {
  const { toast } = useWorkspace()
  return (
    <Modal title={title} onClose={onClose} width={520}>
      <div className="modal-body">
        <p className="confirm-text">{description}</p>
        <div className="link-box">
          <input readOnly value={link} onFocus={(event) => event.target.select()} aria-label="Link" />
          <Button variant="primary" icon="copy" onClick={async () => toast(await copyText(link) ? 'Link copied' : 'Copy the link manually', 'success')}>Copy</Button>
        </div>
      </div>
      <div className="modal-foot"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  )
}

function Profile() {
  const { isAdmin, setAccount, toast } = useWorkspace()
  const [organization, setOrganization] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api('/api/organization').then((result) => setOrganization(result.organization)).catch((error) => toast(error.message, 'error'))
  }, [toast])

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries())
      const result = await api('/api/organization', { method: 'PUT', body: values })
      setOrganization(result.organization)
      setAccount((current) => ({ ...current, organization: { ...current.organization, name: result.organization.name, industry: result.organization.industry } }))
      toast('Company profile saved')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!organization) return <div className="card chart-skeleton" />
  return (
    <form className="card settings-card" onSubmit={submit}>
      <div className="card-head"><div><h2>Company profile</h2><p>{isAdmin ? 'How your business appears across the workspace.' : 'Only owners and admins can change these details.'}</p></div></div>
      <fieldset disabled={!isAdmin || saving} className="form-grid">
        <Field label="Business name"><input name="name" required minLength={2} maxLength={160} defaultValue={organization.name} /></Field>
        <Field label="Business email"><input name="businessEmail" type="email" required defaultValue={organization.businessEmail} /></Field>
        <Field label="Website"><input name="website" maxLength={200} defaultValue={organization.website} placeholder="yourcompany.com" /></Field>
        <Field label="Phone"><input name="phone" maxLength={40} defaultValue={organization.phone} /></Field>
        <Field label="Business type" hint="Shapes your sidebar and suggested modules.">
          <select name="industry" defaultValue={findIndustry(organization.industry)?.label || (organization.industry ? 'Other' : '')}>
            <option value="" disabled>Choose…</option>
            {INDUSTRIES.map((industry) => <option key={industry.key} value={industry.label}>{industry.label}</option>)}
          </select>
        </Field>
        <Field label="Address"><input name="address" maxLength={300} defaultValue={organization.address} /></Field>
      </fieldset>
      {isAdmin && <div className="card-foot"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></div>}
    </form>
  )
}

function InviteForm({ role, onInvited }) {
  const { toast } = useWorkspace()
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    try {
      const values = Object.fromEntries(new FormData(form).entries())
      const result = await api('/api/invitations', { method: 'POST', body: values })
      form.reset()
      onInvited(result)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="invite-form" onSubmit={submit}>
      <input name="email" type="email" required placeholder="name@company.com" aria-label="Email address" />
      <select name="role" defaultValue="staff" aria-label="Role">
        {role === 'owner' && <option value="admin">Admin</option>}
        <option value="manager">Manager</option>
        <option value="staff">Staff</option>
      </select>
      <button type="submit" className="btn btn-primary" disabled={busy}><Icon name="plus" size={16} />{busy ? 'Inviting…' : 'Invite'}</button>
    </form>
  )
}

function Team() {
  const { account, role, isAdmin, reload, data, confirm, toast, navigate } = useWorkspace()
  const [invitations, setInvitations] = useState([])
  const [link, setLink] = useState(null)

  const loadInvites = useCallback(async () => {
    if (!isAdmin) return
    const result = await api('/api/invitations')
    setInvitations(result.invitations)
  }, [isAdmin])

  useEffect(() => {
    loadInvites().catch((error) => toast(error.message, 'error'))
  }, [loadInvites, toast])

  const canManage = (target) => target.role !== 'owner' && target.id !== account.user.id && (role === 'owner' || (role === 'admin' && ['manager', 'staff'].includes(target.role)))
  const assignable = role === 'owner' ? ['admin', 'manager', 'staff'] : ['manager', 'staff']

  async function changeRole(member, nextRole) {
    try {
      await api(`/api/members/${member.id}`, { method: 'PATCH', body: { role: nextRole } })
      await reload(['members'])
      toast(`${member.fullName} is now ${nextRole === 'admin' ? 'an' : 'a'} ${nextRole}`)
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  async function resetLink(member) {
    try {
      const result = await api(`/api/members/${member.id}/reset-link`, { method: 'POST' })
      setLink({
        title: `Password reset for ${member.fullName}`,
        description: `Send this link to ${member.email}. It works once and expires in 24 hours. Their other sessions will be signed out.`,
        link: result.link,
      })
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  function removeMember(member) {
    confirm({
      title: `Remove ${member.fullName}?`,
      message: 'They will be signed out and lose access to this workspace. Their open tasks become unassigned.',
      confirmLabel: 'Remove member',
      onConfirm: async () => {
        await api(`/api/members/${member.id}`, { method: 'DELETE' })
        await reload(['members', 'tasks'])
        toast(`${member.fullName} removed`)
      },
    })
  }

  function revoke(invitation) {
    confirm({
      title: 'Revoke invitation?',
      message: `The invitation link sent to ${invitation.email} will stop working.`,
      confirmLabel: 'Revoke',
      onConfirm: async () => {
        await api(`/api/invitations/${invitation.id}`, { method: 'DELETE' })
        await loadInvites()
        toast('Invitation revoked')
      },
    })
  }

  return (
    <div className="stack">
      {isAdmin && (
        <section className="card settings-card">
          <div className="card-head"><div><h2>Invite your team</h2><p>We create a private invite link for you to share. It works once and expires in 7 days.</p></div></div>
          <InviteForm role={role} onInvited={(result) => {
            loadInvites()
            setLink({
              title: 'Invitation created',
              description: `Share this link with ${result.invitation.email} so they can join as ${result.invitation.role}. Email delivery isn’t connected, so send it yourself.`,
              link: result.link,
            })
          }} />
          {invitations.length > 0 && (
            <ul className="invite-list">
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <span className="avatar avatar-sm pending"><Icon name="clock" size={14} /></span>
                  <div><strong>{invitation.email}</strong><small>Invited {timeAgo(invitation.createdAt)} by {invitation.invitedBy || 'a former member'} · expires {formatDateTime(invitation.expiresAt)}</small></div>
                  <Pill>{capitalize(invitation.role)}</Pill>
                  <button type="button" className="text-link danger" onClick={() => revoke(invitation)}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card table-card">
        <div className="card-head pad"><div><h2>Members</h2><p>{data.members.length} {data.members.length === 1 ? 'person' : 'people'} in {account.organization.name}</p></div></div>
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Open tasks</th><th>Joined</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={member.id}>
                <td>
                  <div className="client-cell">
                    <Avatar name={member.fullName} size="sm" />
                    <div className="two-line"><strong>{member.fullName}{member.id === account.user.id && <span className="you"> · you</span>}</strong><span>{member.email}</span></div>
                  </div>
                </td>
                <td>
                  {canManage(member) ? (
                    <select className="inline-select" aria-label={`Role for ${member.fullName}`} value={member.role} onChange={(event) => changeRole(member, event.target.value)}>
                      {assignable.map((option) => <option key={option} value={option}>{capitalize(option)}</option>)}
                    </select>
                  ) : <span title={roleInfo[member.role]}><Pill tone={member.role === 'owner' ? 'success' : 'neutral'}>{capitalize(member.role)}</Pill></span>}
                </td>
                <td>{member.openTasks}</td>
                <td className="muted">{timeAgo(member.joinedAt)}</td>
                <td className="cell-actions">
                  {member.id !== account.user.id && <IconButton icon="chat" label={`Message ${member.fullName}`} onClick={() => navigate('chat', { dm: member.id })} />}
                  {canManage(member) && <Menu items={[
                    { label: 'Create password reset link', icon: 'key', onSelect: () => resetLink(member) },
                    { label: 'Remove from workspace', icon: 'trash', danger: true, onSelect: () => removeMember(member) },
                  ]} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="role-guide">
        {Object.entries(roleInfo).map(([name, text]) => (
          <div key={name}><strong>{capitalize(name)}</strong><span>{text}</span></div>
        ))}
      </section>
      {link && <LinkModal {...link} onClose={() => setLink(null)} />}
    </div>
  )
}

function Security() {
  const { toast, account, setAccount } = useWorkspace()
  const firstPassword = account.passwordSet === false
  const [sessions, setSessions] = useState([])
  const [busy, setBusy] = useState(false)

  const loadSessions = useCallback(async () => {
    const result = await api('/api/auth/sessions')
    setSessions(result.sessions)
  }, [])

  useEffect(() => {
    loadSessions().catch((error) => toast(error.message, 'error'))
  }, [loadSessions, toast])

  async function changePassword(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (values.newPassword !== values.confirmPassword) {
      toast('The new passwords don’t match.', 'error')
      return
    }
    setBusy(true)
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: values.currentPassword, newPassword: values.newPassword } })
      form.reset()
      await loadSessions()
      if (firstPassword) setAccount((current) => ({ ...current, passwordSet: true }))
      toast(firstPassword ? 'Password set. You can now sign in with your email and password.' : 'Password changed. Other devices were signed out.')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function revokeOthers() {
    try {
      const result = await api('/api/auth/sessions/revoke-others', { method: 'POST' })
      await loadSessions()
      toast(result.revoked ? `Signed out ${result.revoked} other ${result.revoked === 1 ? 'session' : 'sessions'}` : 'No other sessions to sign out')
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  return (
    <div className="grid-1-1">
      <form className="card settings-card" onSubmit={changePassword}>
        <div className="card-head"><div><h2>{firstPassword ? 'Choose your password' : 'Change password'}</h2><p>{firstPassword ? `You signed in with your welcome link. Choose a password (at least 12 characters) to sign in as ${account.user.email} from now on.` : 'Use at least 12 characters. Other devices will be signed out.'}</p></div></div>
        <fieldset disabled={busy} className="form-grid single">
          {!firstPassword && <Field label="Current password"><input name="currentPassword" type="password" required autoComplete="current-password" /></Field>}
          <Field label="New password"><input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></Field>
        </fieldset>
        <div className="card-foot"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : firstPassword ? 'Set password' : 'Update password'}</button></div>
      </form>
      <section className="card settings-card">
        <div className="card-head">
          <div><h2>Active sessions</h2><p>Places where you’re signed in to OVO.</p></div>
        </div>
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <span className="note-icon"><Icon name={session.current ? 'shield' : 'clock'} size={16} /></span>
              <div><strong>{session.current ? 'This device' : 'Signed-in session'}</strong><small>Started {formatDateTime(session.createdAt)} · expires {formatDateTime(session.expiresAt)}</small></div>
              {session.current && <Pill tone="success">Current</Pill>}
            </li>
          ))}
        </ul>
        <div className="card-foot"><Button icon="logout" onClick={revokeOthers} disabled={sessions.length < 2}>Sign out other sessions</Button></div>
      </section>
    </div>
  )
}

function Account() {
  const { account, setAccount, reload, toast, navigate } = useWorkspace()
  const [savingName, setSavingName] = useState(false)
  const [changing, setChanging] = useState(false)
  const [pending, setPending] = useState('')
  const needsPassword = account.passwordSet === false

  async function toggleProductUpdates(event) {
    const productUpdates = event.target.checked
    try {
      await api('/api/auth/profile', { method: 'PUT', body: { productUpdates } })
      setAccount((current) => ({ ...current, productUpdates }))
      toast(productUpdates ? 'You’ll get OVO product updates by email' : 'You won’t get product update emails')
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  async function saveName(event) {
    event.preventDefault()
    setSavingName(true)
    try {
      const { fullName } = Object.fromEntries(new FormData(event.currentTarget).entries())
      const result = await api('/api/auth/profile', { method: 'PUT', body: { fullName } })
      setAccount((current) => ({ ...current, user: { ...current.user, fullName: result.user.fullName } }))
      reload(['members'])
      toast('Your name was saved')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setSavingName(false)
    }
  }

  async function changeEmail(event) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (values.newEmail.trim().toLowerCase() !== values.confirmEmail.trim().toLowerCase()) {
      toast('The two email addresses don’t match.', 'error')
      return
    }
    setChanging(true)
    try {
      const result = await api('/api/auth/change-email', { method: 'POST', body: { newEmail: values.newEmail, currentPassword: values.currentPassword } })
      form.reset()
      if (result.pending) {
        setPending(result.email)
        toast(`Check ${result.email} for a confirmation link`)
      } else {
        setAccount((current) => ({ ...current, user: { ...current.user, email: result.user.email } }))
        reload(['members'])
        toast(`Your sign-in email is now ${result.user.email}`)
      }
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setChanging(false)
    }
  }

  return (
    <div className="grid-1-1">
      <form className="card settings-card" onSubmit={saveName}>
        <div className="card-head"><div><h2>Your details</h2><p>How you appear to your team across OVO.</p></div></div>
        <div className="account-id">
          <Avatar name={account.user.fullName} size="lg" />
          <div><strong>{account.user.fullName}</strong><small>{account.user.email} · {capitalize(account.role)}</small></div>
        </div>
        <fieldset disabled={savingName} className="form-grid single">
          <Field label="Full name"><input name="fullName" required minLength={2} maxLength={120} defaultValue={account.user.fullName} autoComplete="name" /></Field>
        </fieldset>
        <div className="settings-section">
          <span className="field-label">Emails from OVO</span>
          <label className="pref-row">
            <input type="checkbox" checked={account.productUpdates !== false} onChange={toggleProductUpdates} />
            <span><strong>Product updates</strong><small>New features and improvements. Policy, security and service notices are always sent, because they affect your account.</small></span>
          </label>
        </div>
        <div className="card-foot"><button type="submit" className="btn btn-primary" disabled={savingName}>{savingName ? 'Saving…' : 'Save name'}</button></div>
      </form>
      <form className="card settings-card" onSubmit={changeEmail}>
        <div className="card-head"><div><h2>Sign-in email</h2><p>You currently sign in as <strong>{account.user.email}</strong>.</p></div></div>
        {pending && (
          <div className="notice notice-info"><Icon name="mail" size={16} /><span>We sent a confirmation link to <strong>{pending}</strong>. Your email changes when you click it (within 24 hours). Until then, keep signing in with {account.user.email}.</span></div>
        )}
        {needsPassword ? (
          <div className="notice notice-warning">
            <Icon name="key" size={16} />
            <span>Choose a password first, then you can change your email. <button type="button" className="text-link" onClick={() => navigate('settings', { tab: 'security' })}>Set a password</button></span>
          </div>
        ) : (
          <fieldset disabled={changing} className="form-grid single">
            <Field label="New email"><input name="newEmail" type="email" required maxLength={254} autoComplete="email" placeholder="you@company.com" /></Field>
            <Field label="Type the new email again"><input name="confirmEmail" type="email" required maxLength={254} autoComplete="off" /></Field>
            <Field label="Your current password" hint="To keep your account safe."><input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" /></Field>
          </fieldset>
        )}
        {!needsPassword && <div className="card-foot"><button type="submit" className="btn btn-primary" disabled={changing}>{changing ? 'Saving…' : 'Change email'}</button></div>}
      </form>
    </div>
  )
}

function Settings() {
  const { params, navigate } = useWorkspace()
  const tab = ['account', 'profile', 'team', 'security'].includes(params.tab) ? params.tab : 'account'
  return (
    <div className="stack">
      <PageHeader eyebrow="Company / Settings" title="Settings" description="Your account, company profile, team and security." />
      <Segmented label="Settings sections" value={tab} onChange={(next) => navigate('settings', { tab: next })} options={[
        { value: 'account', label: 'My account', icon: 'clients' },
        { value: 'profile', label: 'Company profile', icon: 'building' },
        { value: 'team', label: 'Team', icon: 'team' },
        { value: 'security', label: 'Security', icon: 'shield' },
      ]} />
      {tab === 'account' && <Account />}
      {tab === 'profile' && <Profile />}
      {tab === 'team' && <Team />}
      {tab === 'security' && <Security />}
    </div>
  )
}

export default Settings

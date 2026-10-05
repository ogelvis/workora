import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, Button, Field, Modal, copyText } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { capitalize, timeAgo } from '../lib/format.js'
import { useWorkspace } from './context.js'

const LEVELS = [
  { value: 'view', label: 'View only', hint: 'Can see records' },
  { value: 'comment', label: 'Comment', hint: 'Can see and discuss records' },
  { value: 'edit', label: 'Edit', hint: 'Can add and change records' },
  { value: 'full', label: 'Full access', hint: 'Can also change columns, settings and sharing' },
]
const MANAGER_ROLES = ['owner', 'admin', 'manager']

function SendTab({ type, id, name }) {
  const { data, account, toast } = useWorkspace()
  const [chosen, setChosen] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const people = data.members.filter((member) => member.id !== account.user.id)

  async function send() {
    setBusy(true)
    try {
      const result = await api('/api/shares/send', { method: 'POST', body: { resourceType: type, resourceId: id, userIds: chosen, message } })
      toast(result.skipped
        ? `Sent to ${result.sent}. ${result.skipped} ${result.skipped === 1 ? 'person doesn’t' : 'people don’t'} have access to this sheet.`
        : `Sent to ${result.sent} ${result.sent === 1 ? 'person' : 'people'}`, result.skipped ? 'error' : 'success')
      setChosen([])
      setMessage('')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm">
      <p className="confirm-text">They’ll get a notification that opens <strong>{name}</strong> directly.</p>
      <div className="share-people">
        {people.map((member) => (
          <label key={member.id} className={`share-person${chosen.includes(member.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={chosen.includes(member.id)} onChange={() => setChosen((current) => (current.includes(member.id) ? current.filter((item) => item !== member.id) : [...current, member.id]))} />
            <Avatar name={member.fullName} size="sm" />
            <span><strong>{member.fullName}</strong><small>{capitalize(member.role)}</small></span>
          </label>
        ))}
        {!people.length && <p className="muted-note">Invite teammates from Settings → Team to share with them.</p>}
      </div>
      <Field label="Message (optional)"><textarea rows={2} maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="e.g. Please call this client today" /></Field>
      <div className="share-actions"><Button variant="primary" icon="send" disabled={!chosen.length || busy} onClick={send}>{busy ? 'Sending…' : `Send${chosen.length ? ` to ${chosen.length}` : ''}`}</Button></div>
    </div>
  )
}

function LinkTab({ type, id, views }) {
  const { toast, confirm } = useWorkspace()
  const [links, setLinks] = useState(null)
  const [canShare, setCanShare] = useState(false)
  const [viewId, setViewId] = useState('')
  const [expires, setExpires] = useState('30')
  const [allowDownload, setAllowDownload] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api(`/api/shares?type=${type}&id=${id}`).then((result) => { setLinks(result.links); setCanShare(result.canShare) }).catch((error) => toast(error.message, 'error'))
  }, [type, id, toast])
  useEffect(() => { load() }, [load])

  const url = (token) => `${window.location.origin}/s/${token}`

  async function create() {
    setBusy(true)
    try {
      const result = await api('/api/shares', { method: 'POST', body: { resourceType: type, resourceId: id, viewId: viewId || null, allowDownload, expiresInDays: expires ? Number(expires) : null } })
      await copyText(url(result.link.token))
      toast('Secure link created and copied')
      load()
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  function revoke(link) {
    confirm({
      title: 'Turn off this link?',
      message: 'Anyone with it will no longer be able to open it. This can’t be undone.',
      confirmLabel: 'Turn off',
      onConfirm: async () => { await api(`/api/shares/${link.id}`, { method: 'DELETE' }); toast('Link turned off'); load() },
    })
  }

  return (
    <div className="stack-sm">
      <p className="confirm-text">Anyone with a secure link can <strong>view</strong> {type === 'file' ? 'and download this file' : type === 'record' ? 'this record' : 'this sheet'} without signing in. They can’t change anything.</p>
      {canShare ? (
        <div className="share-create">
          {type === 'sheet' && (
            <Field label="Show">
              <select value={viewId} onChange={(event) => setViewId(event.target.value)}>
                <option value="">All records</option>
                {(views || []).map((view) => <option key={view.id} value={view.id}>Saved view: {view.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Link expires">
            <select value={expires} onChange={(event) => setExpires(event.target.value)}>
              <option value="1">After 1 day</option>
              <option value="7">After 7 days</option>
              <option value="30">After 30 days</option>
              <option value="90">After 90 days</option>
              <option value="">Never</option>
            </select>
          </Field>
          {type === 'sheet' && <label className="check-row"><input type="checkbox" checked={allowDownload} onChange={(event) => setAllowDownload(event.target.checked)} /> Let viewers download as Excel or CSV</label>}
          <div className="share-actions"><Button variant="primary" icon="link" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create secure link'}</Button></div>
        </div>
      ) : <div className="notice notice-warning"><Icon name="shield" size={16} /><span>Only people with full access can create links for this.</span></div>}
      {links && links.length > 0 && (
        <ul className="share-links">
          {links.map((link) => {
            const expired = link.expiresAt && new Date(link.expiresAt) < new Date()
            return (
              <li key={link.id} className={expired ? 'expired' : ''}>
                <Icon name="link" size={15} />
                <div>
                  <input readOnly value={url(link.token)} onFocus={(event) => event.target.select()} aria-label="Share link" />
                  <small>
                    {link.viewId ? `View “${(views || []).find((view) => view.id === link.viewId)?.name || 'saved view'}” · ` : ''}
                    {expired ? 'Expired' : link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}` : 'Never expires'}
                    {' · '}{link.viewCount} {link.viewCount === 1 ? 'view' : 'views'}{link.lastViewedAt ? ` · last ${timeAgo(link.lastViewedAt)}` : ''}
                  </small>
                </div>
                <Button size="sm" icon="copy" onClick={async () => toast(await copyText(url(link.token)) ? 'Link copied' : 'Copy the link manually')}>Copy</Button>
                {canShare && <Button size="sm" variant="danger" onClick={() => revoke(link)}>Turn off</Button>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function AccessTab({ sheet, onSaved }) {
  const { data, toast } = useWorkspace()
  const [access, setAccess] = useState(() => ({ default: sheet.access?.default || 'edit', members: { ...(sheet.access?.members || {}) } }))
  const [busy, setBusy] = useState(false)
  const people = data.members.filter((member) => !MANAGER_ROLES.includes(member.role) && member.id !== sheet.createdById)

  async function save() {
    setBusy(true)
    try {
      const members = Object.fromEntries(Object.entries(access.members).filter(([, level]) => level && level !== 'default'))
      await onSaved({ access: { default: access.default, members } })
      toast('Access saved')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm">
      <p className="confirm-text">Owners, admins, managers and whoever created this sheet always have full access.</p>
      <Field label="Everyone else in the workspace">
        <select value={access.default} onChange={(event) => setAccess((current) => ({ ...current, default: event.target.value }))}>
          <option value="none">No access (hidden)</option>
          {LEVELS.filter((level) => level.value !== 'full').map((level) => <option key={level.value} value={level.value}>{level.label} — {level.hint}</option>)}
        </select>
      </Field>
      {people.length > 0 && (
        <div className="field">
          <span className="field-label">Exceptions for specific people</span>
          <ul className="access-list">
            {people.map((member) => (
              <li key={member.id}>
                <Avatar name={member.fullName} size="sm" />
                <span><strong>{member.fullName}</strong><small>{capitalize(member.role)}</small></span>
                <select value={access.members[member.id] || 'default'} onChange={(event) => setAccess((current) => ({ ...current, members: { ...current.members, [member.id]: event.target.value } }))} aria-label={`Access for ${member.fullName}`}>
                  <option value="default">Same as everyone</option>
                  <option value="none">No access</option>
                  {LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="share-actions"><Button variant="primary" icon="check" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save access'}</Button></div>
    </div>
  )
}

// Share anything: send it to a teammate, make a secure link, or (for sheets) set who can do what.
export function ShareModal({ type, id, name, sheet, onSheetSaved, onClose }) {
  const [tab, setTab] = useState('send')
  const tabs = [
    { key: 'send', label: 'Send to teammate', icon: 'send' },
    { key: 'link', label: 'Secure link', icon: 'link' },
    type === 'sheet' && sheet?.permission === 'full' && { key: 'access', label: 'Team access', icon: 'shield' },
  ].filter(Boolean)
  return (
    <Modal title={`Share ${name}`} eyebrow={type === 'file' ? 'File' : type === 'record' ? 'Record' : 'Sheet'} onClose={onClose} width={620}>
      <div className="modal-body stack-sm">
        <div className="share-tabs" role="tablist">
          {tabs.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}><Icon name={item.icon} size={15} />{item.label}</button>
          ))}
        </div>
        {tab === 'send' && <SendTab type={type} id={id} name={name} />}
        {tab === 'link' && <LinkTab type={type} id={id} views={sheet?.views} />}
        {tab === 'access' && <AccessTab sheet={sheet} onSaved={onSheetSaved} />}
      </div>
    </Modal>
  )
}

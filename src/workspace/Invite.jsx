import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Modal, copyText } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useWorkspace } from './context.js'

const ROLES = [
  { value: 'staff', label: 'Team member', hint: 'Works on their tasks, files, chat and calendar.', icon: 'tasks' },
  { value: 'manager', label: 'Manager', hint: 'Also creates projects and clients, and assigns work.', icon: 'projects' },
  { value: 'admin', label: 'Admin', hint: 'Also manages the team, billing and settings.', icon: 'shield', ownerOnly: true },
]

const splitEmails = (text) => [...new Set(text.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))]
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

function shareText(link, organization) {
  return `You're invited to join ${organization} on OVO. Open this link to set up your account: ${link}`
}

// One simple place to invite people: type emails, pick what they can do, send.
export function InviteModal({ onClose }) {
  const { account, role: myRole, toast } = useWorkspace()
  const [text, setText] = useState('')
  const [role, setRole] = useState('staff')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const emails = splitEmails(text)
  const invalid = emails.filter((email) => !looksLikeEmail(email))
  const organization = account.organization.name

  async function send(event) {
    event.preventDefault()
    if (!emails.length || invalid.length) return
    setBusy(true)
    const done = []
    for (const email of emails.slice(0, 25)) {
      try {
        const result = await api('/api/invitations', { method: 'POST', body: { email, role } })
        done.push({ email, ok: true, link: result.link, emailed: result.emailed })
      } catch (error) {
        done.push({ email, ok: false, error: error.message })
      }
    }
    setResults(done)
    setBusy(false)
    window.dispatchEvent(new Event('ovo:invited'))
  }

  if (results) {
    const sent = results.filter((item) => item.ok)
    const allEmailed = sent.length && sent.every((item) => item.emailed)
    return (
      <Modal title={sent.length ? 'Invitations ready' : 'Nothing was sent'} eyebrow="Invite people" onClose={onClose} width={600}>
        <div className="modal-body stack-sm">
          {sent.length > 0 && (
            <p className="confirm-text">
              {allEmailed
                ? <>We’ve emailed {sent.length === 1 ? 'the invitation' : `${sent.length} invitations`}. They click <strong>Accept invitation</strong>, choose a password and they’re in.</>
                : <>Send each person their link — by WhatsApp, SMS or email. They open it, choose a password and they’re in. Links work once and expire in 7 days.</>}
            </p>
          )}
          <ul className="invite-results">
            {results.map((item) => (
              <li key={item.email} className={item.ok ? 'ok' : 'error'}>
                <div className="invite-results-head">
                  <Icon name={item.ok ? 'check' : 'alert'} size={15} />
                  <strong>{item.email}</strong>
                  {item.ok && item.emailed && <span className="invite-tag">Email sent</span>}
                </div>
                {item.ok ? (
                  <div className="invite-share">
                    <input readOnly value={item.link} onFocus={(event) => event.target.select()} aria-label={`Invite link for ${item.email}`} />
                    <Button size="sm" icon="copy" onClick={async () => toast(await copyText(item.link) ? 'Link copied' : 'Copy the link manually')}>Copy link</Button>
                    <a className="btn btn-sm btn-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(shareText(item.link, organization))}`} target="_blank" rel="noreferrer"><Icon name="chat" size={15} />WhatsApp</a>
                  </div>
                ) : <p className="invite-error">{item.error}</p>}
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-foot">
          <Button onClick={() => { setResults(null); setText('') }}>Invite more people</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Invite people to ${organization}`} eyebrow="Invite people" onClose={onClose} width={600} busy={busy}>
      <form onSubmit={send}>
        <div className="modal-body stack-sm">
          <label className="field">
            <span className="field-label">Their email addresses</span>
            <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} autoFocus
              placeholder={'ada@company.com\nbayo@company.com'} aria-describedby="invite-hint" />
            <small id="invite-hint" className="field-hint">
              {emails.length
                ? invalid.length ? <span className="invite-error">Check {invalid.join(', ')} — {invalid.length === 1 ? 'it doesn’t' : 'they don’t'} look like an email.</span> : `${emails.length} ${emails.length === 1 ? 'person' : 'people'} to invite`
                : 'Add one or more — put each on its own line or separate them with commas.'}
            </small>
          </label>
          <div className="field">
            <span className="field-label">What can they do?</span>
            <div className="invite-roles" role="radiogroup" aria-label="Role">
              {ROLES.filter((item) => !item.ownerOnly || myRole === 'owner').map((item) => (
                <button key={item.value} type="button" role="radio" aria-checked={role === item.value} className={role === item.value ? 'active' : ''} onClick={() => setRole(item.value)}>
                  <span className="invite-role-icon"><Icon name={item.icon} size={16} /></span>
                  <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon="send" disabled={busy || !emails.length || invalid.length > 0}>
            {busy ? 'Sending…' : emails.length > 1 ? `Invite ${emails.length} people` : 'Send invitation'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Empty, Field, Modal, Pill } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { useWorkspace } from '../workspace/context.js'
import { SectionHeader } from './Admin.jsx'

const CATEGORIES = [
  { value: 'product', label: 'Product update', hint: 'New features and improvements. People can opt out.', tone: 'violet' },
  { value: 'policy', label: 'Policy update', hint: 'Changes to your terms of use or privacy policy. Always sent.', tone: 'teal' },
  { value: 'security', label: 'Security notice', hint: 'Something people must know to keep their account safe. Always sent.', tone: 'rose' },
  { value: 'service', label: 'Service notice', hint: 'Maintenance, outages or account changes. Always sent.', tone: 'amber' },
]
const AUDIENCES = [
  { value: 'everyone', label: 'Everyone on OVO' },
  { value: 'admins', label: 'Workspace owners and admins' },
  { value: 'owners', label: 'Workspace owners only' },
]
const EMPTY = { category: 'product', audience: 'everyone', title: '', body: '', ctaLabel: '', ctaUrl: '' }
const categoryInfo = (value) => CATEGORIES.find((item) => item.value === value) || CATEGORIES[0]

function Composer({ emailReady, onSent }) {
  const { toast } = useWorkspace()
  const [draft, setDraft] = useState(EMPTY)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState(false)
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const ready = draft.title.trim() && draft.body.trim()

  // The preview is the real email, rendered by the server a moment after typing stops.
  useEffect(() => {
    const values = { ...draft, title: draft.title.trim() || 'Your title appears here', body: draft.body.trim() || 'Your message appears here.' }
    const timer = setTimeout(() => {
      api('/api/admin/announcements/preview', { method: 'POST', body: values })
        .then((result) => { setPreview(result); setPreviewError('') })
        .catch((error) => setPreviewError(error.message))
    }, 350)
    return () => clearTimeout(timer)
  }, [draft])

  async function sendTest() {
    setBusy('test')
    try {
      const result = await api('/api/admin/announcements/test', { method: 'POST', body: draft })
      toast(`Test sent to ${result.sentTo}`)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy('')
    }
  }

  async function send() {
    setBusy('send')
    try {
      const result = await api('/api/admin/announcements', { method: 'POST', body: draft })
      setConfirming(false)
      setDraft(EMPTY)
      toast(result.emailConfigured
        ? `Sent to ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}${result.failed ? ` (${result.failed} emails failed)` : ''}`
        : `Posted inside OVO for ${result.recipients} ${result.recipients === 1 ? 'person' : 'people'}. Emails will go out once email sending is set up.`)
      onSent()
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="an-compose">
      <form className="card an-form" onSubmit={(event) => { event.preventDefault(); if (ready) setConfirming(true) }}>
        <div className="card-head"><div><h2>New announcement</h2><p>Sent by email and shown inside every workspace it reaches.</p></div></div>
        <div className="an-fields">
          <div className="field">
            <span className="field-label">Type</span>
            <div className="an-categories">
              {CATEGORIES.map((item) => (
                <button key={item.value} type="button" className={`tone-${item.tone}${draft.category === item.value ? ' active' : ''}`} onClick={() => set({ category: item.value })}>
                  <strong>{item.label}</strong><small>{item.hint}</small>
                </button>
              ))}
            </div>
          </div>
          <Field label="Send to">
            <select value={draft.audience} onChange={(event) => set({ audience: event.target.value })}>
              {AUDIENCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Title"><input value={draft.title} maxLength={150} onChange={(event) => set({ title: event.target.value })} placeholder="e.g. Introducing OVO Forms and Automations" required /></Field>
          <Field label="Message" hint="Leave a blank line between paragraphs. Start lines with “- ” for a bullet list.">
            <textarea rows={9} maxLength={10000} value={draft.body} onChange={(event) => set({ body: event.target.value })} required
              placeholder={'We’ve made OVO even better for your team.\n\n- Build forms that fill your sheets\n- Let automations handle routine follow-ups\n\nSign in to try them today.'} />
          </Field>
          <div className="form-grid">
            <Field label="Button text (optional)"><input value={draft.ctaLabel} maxLength={40} onChange={(event) => set({ ctaLabel: event.target.value })} placeholder="Learn more" /></Field>
            <Field label="Button link (optional)"><input type="url" value={draft.ctaUrl} maxLength={500} onChange={(event) => set({ ctaUrl: event.target.value })} placeholder="https://ovo.truxpylot.com" /></Field>
          </div>
        </div>
        {!emailReady && <div className="notice notice-warning"><Icon name="alert" size={16} /><span>Email sending isn’t set up yet, so announcements appear inside OVO only. Add RESEND_API_KEY and EMAIL_FROM in Vercel to email them.</span></div>}
        <div className="card-foot an-actions">
          <Button icon="send" onClick={sendTest} disabled={!ready || Boolean(busy) || !emailReady}>{busy === 'test' ? 'Sending…' : 'Send test to my inbox'}</Button>
          <Button type="submit" variant="primary" icon="bell" disabled={!ready || Boolean(busy)}>Send announcement</Button>
        </div>
      </form>
      <div className="an-preview">
        <div className="an-preview-head">
          <span className="eyebrow">Email preview</span>
          {preview && <small>{preview.recipients} {preview.recipients === 1 ? 'recipient' : 'recipients'}</small>}
        </div>
        <div className="an-inbox">
          <div className="an-inbox-row">
            <span className="an-inbox-from">OVO</span>
            <span className="an-inbox-subject">{preview?.subject || '…'}</span>
          </div>
          {previewError ? <p className="form-error">{previewError}</p> : <iframe title="Email preview" sandbox="" srcDoc={preview?.html || ''} />}
        </div>
      </div>
      {confirming && (
        <Modal title="Send this announcement?" onClose={() => setConfirming(false)} width={480} busy={busy === 'send'}>
          <div className="modal-body stack-sm">
            <p className="confirm-text"><strong>{draft.title}</strong> goes to <strong>{preview?.recipients ?? '…'} {preview?.recipients === 1 ? 'person' : 'people'}</strong> ({AUDIENCES.find((item) => item.value === draft.audience).label.toLowerCase()}) as a {categoryInfo(draft.category).label.toLowerCase()}.</p>
            <p className="muted-note">This can’t be unsent. Send yourself a test first if you haven’t.</p>
          </div>
          <div className="modal-foot">
            <Button onClick={() => setConfirming(false)} disabled={busy === 'send'}>Cancel</Button>
            <Button variant="primary" icon="send" onClick={send} disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : 'Send now'}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function AnnouncementsSection() {
  const { toast } = useWorkspace()
  const [state, setState] = useState(null)
  const [open, setOpen] = useState(null)
  const load = useCallback(() => {
    api('/api/admin/announcements').then(setState).catch((error) => toast(error.message, 'error'))
  }, [toast])
  useEffect(() => { load() }, [load])

  return (
    <div className="stack">
      <SectionHeader eyebrow="Communicate" title="Announcements" description="Tell your customers about new features, policy changes, security matters or planned maintenance — by email and inside OVO." />
      <Composer emailReady={state?.emailConfigured ?? true} onSent={load} />
      <div className="card">
        <div className="card-head"><div><h2>Sent announcements</h2><p>Newest first.</p></div></div>
        {!state ? <div className="cx-skeleton"><span /><span /></div> : !state.announcements.length ? (
          <Empty icon="bell" title="Nothing sent yet">Your announcements will be listed here with how many people they reached.</Empty>
        ) : (
          <ul className="an-history">
            {state.announcements.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>
                  <Pill tone={{ product: 'info', policy: 'success', security: 'danger', service: 'warning' }[item.category]}>{categoryInfo(item.category).label}</Pill>
                  <strong>{item.title}</strong>
                  <small>{formatDateTime(item.sentAt)} · {item.recipientCount} reached · {item.emailedCount} emailed{item.failedCount ? ` · ${item.failedCount} failed` : ''}</small>
                  <Icon name={open === item.id ? 'up' : 'down'} size={15} />
                </button>
                {open === item.id && <div className="an-history-body">{item.body}{item.ctaUrl && <p><a href={item.ctaUrl} target="_blank" rel="noreferrer">{item.ctaLabel || 'Learn more'}</a></p>}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

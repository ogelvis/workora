import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, Button, Empty, Field, Modal, Pill } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { useWorkspace } from '../workspace/context.js'
import { SectionHeader } from './Admin.jsx'

const CATEGORIES = [
  { value: 'message', label: 'Direct message', hint: 'A personal message to one person or a few. Always sent.', tone: 'sky' },
  { value: 'product', label: 'Product update', hint: 'New features and improvements. People can opt out.', tone: 'violet' },
  { value: 'policy', label: 'Policy update', hint: 'Changes to your terms of use or privacy policy. Always sent.', tone: 'teal' },
  { value: 'security', label: 'Security notice', hint: 'Something people must know to keep their account safe. Always sent.', tone: 'rose' },
  { value: 'service', label: 'Service notice', hint: 'Maintenance, outages or account changes. Always sent.', tone: 'amber' },
]
const AUDIENCES = [
  { value: 'people', label: 'Specific people' },
  { value: 'workspace', label: 'Everyone in one business' },
  { value: 'everyone', label: 'Everyone on OVO' },
  { value: 'admins', label: 'Workspace owners and admins' },
  { value: 'owners', label: 'Workspace owners only' },
]
const EMPTY = { category: 'product', audience: 'everyone', title: '', body: '', ctaLabel: '', ctaUrl: '' }

// "Message" buttons elsewhere in the console open this page with ?to=<user id>&toName=<name>.
function initialDraft() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const to = params.get('to')
  return to
    ? { draft: { ...EMPTY, category: 'message', audience: 'people' }, people: [{ id: to, fullName: params.get('toName') || 'Selected person', organizationName: params.get('toBusiness') || '' }] }
    : { draft: EMPTY, people: [] }
}

// Search and pick who receives it: people (several) or one business.
function TargetPicker({ audience, people, setPeople, business, setBusiness }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      api(`/api/admin/announcements/targets?q=${encodeURIComponent(query.trim())}`)
        .then((result) => { if (live) setResults(result) })
        .catch(() => { if (live) setResults({ people: [], businesses: [] }) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [query])

  const chosen = new Set(people.map((person) => person.id))
  return (
    <div className="field an-targets">
      <span className="field-label">{audience === 'people' ? 'Who should get it?' : 'Which business?'}</span>
      {audience === 'people' && people.length > 0 && (
        <div className="an-chips">
          {people.map((person) => (
            <span key={person.id} className="an-chip">
              <Avatar name={person.fullName} size="xs" />
              {person.fullName}{person.organizationName ? <small>{person.organizationName}</small> : null}
              <button type="button" aria-label={`Remove ${person.fullName}`} onClick={() => setPeople(people.filter((item) => item.id !== person.id))}><Icon name="close" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {audience === 'workspace' && business && (
        <div className="an-chips">
          <span className="an-chip"><Icon name="building" size={13} />{business.name}<small>{business.members} {business.members === 1 ? 'person' : 'people'}</small>
            <button type="button" aria-label="Choose another business" onClick={() => setBusiness(null)}><Icon name="close" size={12} /></button></span>
        </div>
      )}
      {(audience === 'people' || !business) && <>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={audience === 'people' ? 'Search by name, email or business…' : 'Search businesses…'} aria-label="Search" />
        <ul className="an-results">
          {!results ? <li className="muted">Searching…</li> : audience === 'people' ? (
            results.people.length ? results.people.map((person) => (
              <li key={person.id}>
                <button type="button" disabled={chosen.has(person.id)} onClick={() => setPeople([...people, person])}>
                  <Avatar name={person.fullName} size="sm" />
                  <span><strong>{person.fullName}</strong><small>{person.email} · {person.organizationName}</small></span>
                  <em>{chosen.has(person.id) ? 'Added' : 'Add'}</em>
                </button>
              </li>
            )) : <li className="muted">No one matches “{query}”.</li>
          ) : results.businesses.length ? results.businesses.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => setBusiness(item)}>
                <span className="an-result-icon"><Icon name="building" size={15} /></span>
                <span><strong>{item.name}</strong><small>{item.members} {item.members === 1 ? 'person' : 'people'}</small></span>
                <em>Choose</em>
              </button>
            </li>
          )) : <li className="muted">No business matches “{query}”.</li>}
        </ul>
      </>}
    </div>
  )
}
const categoryInfo = (value) => CATEGORIES.find((item) => item.value === value) || CATEGORIES[0]

function Composer({ emailReady, onSent }) {
  const { toast } = useWorkspace()
  const [start] = useState(initialDraft)
  const [draft, setDraft] = useState(start.draft)
  const [people, setPeople] = useState(start.people)
  const [business, setBusiness] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState(false)
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const targeted = draft.audience === 'people' ? people.length > 0 : draft.audience === 'workspace' ? Boolean(business) : true
  const ready = draft.title.trim() && draft.body.trim() && targeted
  // What the server needs to know about who receives it.
  const payload = { ...draft, userIds: draft.audience === 'people' ? people.map((person) => person.id) : [], organizationId: draft.audience === 'workspace' ? business?.id : undefined }
  const payloadKey = JSON.stringify(payload)
  const audienceText = draft.audience === 'people'
    ? people.map((person) => person.fullName).join(', ')
    : draft.audience === 'workspace' ? `everyone at ${business?.name}` : AUDIENCES.find((item) => item.value === draft.audience).label.toLowerCase()

  // The preview is the real email, rendered by the server a moment after typing stops.
  useEffect(() => {
    if (!targeted) { setPreview((current) => current && { ...current, recipients: 0 }); return undefined }
    const values = { ...JSON.parse(payloadKey), title: draft.title.trim() || 'Your title appears here', body: draft.body.trim() || 'Your message appears here.' }
    const timer = setTimeout(() => {
      api('/api/admin/announcements/preview', { method: 'POST', body: values })
        .then((result) => { setPreview(result); setPreviewError('') })
        .catch((error) => setPreviewError(error.message))
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey, targeted])

  async function sendTest() {
    setBusy('test')
    try {
      const result = await api('/api/admin/announcements/test', { method: 'POST', body: { ...payload, audience: 'everyone' } })
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
      const result = await api('/api/admin/announcements', { method: 'POST', body: payload })
      setConfirming(false)
      setDraft(EMPTY)
      setPeople([])
      setBusiness(null)
      if (window.location.hash.includes('to=')) window.history.replaceState(null, '', '#/?tab=announcements')
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
        <div className="card-head"><div><h2>{draft.category === 'message' ? 'New message' : 'New announcement'}</h2><p>Sent by email and shown in each person’s dashboard under What’s new.</p></div></div>
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
          {(draft.audience === 'people' || draft.audience === 'workspace') && (
            <TargetPicker audience={draft.audience} people={people} setPeople={setPeople} business={business} setBusiness={setBusiness} />
          )}
          <Field label="Title"><input value={draft.title} maxLength={150} onChange={(event) => set({ title: event.target.value })} placeholder="e.g. Introducing OVO Forms and Automations" required /></Field>
          <Field label="Message" hint="Each email starts with “Hi [their first name],” for you. Leave a blank line between paragraphs; start lines with “- ” for a bullet list.">
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
          <Button type="submit" variant="primary" icon={draft.category === 'message' ? 'send' : 'bell'} disabled={!ready || Boolean(busy)}>{draft.category === 'message' ? 'Send message' : 'Send announcement'}</Button>
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
        <Modal title={draft.category === 'message' ? 'Send this message?' : 'Send this announcement?'} onClose={() => setConfirming(false)} width={480} busy={busy === 'send'}>
          <div className="modal-body stack-sm">
            <p className="confirm-text"><strong>{draft.title}</strong> goes to <strong>{preview?.recipients ?? '…'} {preview?.recipients === 1 ? 'person' : 'people'}</strong> ({audienceText}) as a {categoryInfo(draft.category).label.toLowerCase()}, by email and in their dashboard.</p>
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
                  <Pill tone={{ product: 'info', policy: 'success', security: 'danger', service: 'warning', message: 'neutral' }[item.category]}>{categoryInfo(item.category).label}</Pill>
                  <strong>{item.title}</strong>
                  <small>{item.recipientNames ? `To ${item.recipientNames} · ` : item.organizationName ? `To everyone at ${item.organizationName} · ` : ''}{formatDateTime(item.sentAt)} · {item.recipientCount} reached · {item.emailedCount} emailed{item.failedCount ? ` · ${item.failedCount} failed` : ''}</small>
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

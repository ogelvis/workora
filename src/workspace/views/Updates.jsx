import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Empty, PageHeader } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { useWorkspace } from '../context.js'

export const UPDATE_CATEGORIES = {
  product: { label: 'Product update', tone: 'violet', icon: 'sparkle' },
  policy: { label: 'Policy update', tone: 'teal', icon: 'scale' },
  security: { label: 'Security notice', tone: 'rose', icon: 'shield' },
  service: { label: 'Service notice', tone: 'amber', icon: 'alert' },
  message: { label: 'Message from OVO', tone: 'sky', icon: 'mail' },
}

// Blank lines make paragraphs and "- " lines make lists, matching the email.
function Body({ text }) {
  return text.trim().split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length && lines.every((line) => /^[-•*]\s+/.test(line))) {
      return <ul key={index}>{lines.map((line) => <li key={line}>{line.replace(/^[-•*]\s+/, '')}</li>)}</ul>
    }
    return <p key={index}>{lines.map((line, at) => <span key={at}>{at > 0 && <br />}{line}</span>)}</p>
  })
}

// OVO's own announcements: product news, policy changes, security and service notices.
function Updates() {
  const { params, toast } = useWorkspace()
  const [items, setItems] = useState(null)

  useEffect(() => {
    api('/api/announcements').then((result) => setItems(result.announcements)).catch((error) => toast(error.message, 'error'))
  }, [toast])

  useEffect(() => {
    if (items && params.id) document.getElementById(`update-${params.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [items, params.id])

  return (
    <div className="stack narrow">
      <PageHeader eyebrow="OVO" title="What’s new" description="Product news, policy changes, important notices and messages from the OVO team." />
      {!items ? <div className="card chart-skeleton" /> : !items.length ? (
        <Empty icon="sparkle" title="No updates yet">Announcements from the OVO team will appear here.</Empty>
      ) : items.map((item) => {
        const info = UPDATE_CATEGORIES[item.category] || UPDATE_CATEGORIES.service
        return (
          <article key={item.id} id={`update-${item.id}`} className={`card update-card tone-${info.tone}${params.id === item.id ? ' highlighted' : ''}`}>
            <div className="update-meta">
              <span className="update-tag"><Icon name={info.icon} size={13} />{info.label}</span>
              {item.personal && <span className="update-personal">Sent to you</span>}
              <small>{new Date(item.sentAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</small>
            </div>
            <h2>{item.title}</h2>
            <div className="update-body"><Body text={item.body} /></div>
            {item.ctaUrl && <a className="btn btn-primary update-cta" href={item.ctaUrl} target="_blank" rel="noreferrer">{item.ctaLabel || 'Learn more'}<Icon name="right" size={15} /></a>}
          </article>
        )
      })}
    </div>
  )
}

export default Updates

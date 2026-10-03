import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Field, IconButton, Modal } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { formatTime } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

const POLL_MS = 4000

function dayLabel(value) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function NewChannel({ onClose, onCreated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries())
      const result = await api('/api/channels', { method: 'POST', body: values })
      onCreated(result.channel)
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }
  return (
    <Modal title="New channel" eyebrow="Team chat" onClose={onClose} busy={busy} width={460}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="Channel name" hint="Lowercase letters, numbers and dashes" wide><input name="name" required maxLength={40} placeholder="website-redesign" /></Field>
          <Field label="Description" wide><input name="description" maxLength={200} placeholder="What is this channel about?" /></Field>
          {error && <p className="form-error field-wide" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create channel'}</button>
        </div>
      </form>
    </Modal>
  )
}

function Chat() {
  const { account, isManager, toast, confirm, data } = useWorkspace()
  const [channels, setChannels] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const scroller = useRef(null)
  const stickToBottom = useRef(true)
  const active = channels.find((channel) => channel.id === activeId)

  useEffect(() => {
    api('/api/channels')
      .then((result) => {
        setChannels(result.channels)
        setActiveId((current) => current || result.channels[0]?.id || null)
      })
      .catch((error) => toast(error.message, 'error'))
  }, [toast])

  const loadMessages = useCallback(async (channelId) => {
    const result = await api(`/api/channels/${channelId}/messages`)
    setMessages((current) => {
      const same = current.length === result.messages.length && current.at(-1)?.id === result.messages.at(-1)?.id
      return same ? current : result.messages
    })
  }, [])

  useEffect(() => {
    if (!activeId) return undefined
    setMessages([])
    stickToBottom.current = true
    loadMessages(activeId).catch((error) => toast(error.message, 'error'))
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadMessages(activeId).catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [activeId, loadMessages, toast])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight
  }, [messages])

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !activeId) return
    setSending(true)
    try {
      const result = await api(`/api/channels/${activeId}/messages`, { method: 'POST', body: { body } })
      stickToBottom.current = true
      setMessages((current) => [...current, result.message])
      setDraft('')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setSending(false)
    }
  }

  function deleteChannel(channel) {
    confirm({
      title: `Delete #${channel.name}?`,
      message: 'The channel and all of its messages will be permanently deleted.',
      onConfirm: async () => {
        await api(`/api/channels/${channel.id}`, { method: 'DELETE' })
        const rest = channels.filter((item) => item.id !== channel.id)
        setChannels(rest)
        setActiveId(rest[0]?.id || null)
        toast('Channel deleted')
      },
    })
  }

  // Precompute day separators and author grouping so render stays pure.
  const rows = useMemo(() => messages.map((message, index) => {
    const previous = messages[index - 1]
    const day = dayLabel(message.createdAt)
    const newDay = !previous || dayLabel(previous.createdAt) !== day
    const grouped = !newDay && previous.userId === message.userId
      && new Date(message.createdAt) - new Date(previous.createdAt) < 5 * 60_000
    return { message, day, newDay, grouped }
  }), [messages])

  return (
    <div className="chat">
      <aside className="chat-channels">
        <div className="chat-channels-head">
          <span className="eyebrow">Channels</span>
          {isManager && <IconButton icon="plus" label="New channel" onClick={() => setCreating(true)} />}
        </div>
        <ul>
          {channels.map((channel) => (
            <li key={channel.id}>
              <button type="button" className={channel.id === activeId ? 'active' : ''} onClick={() => setActiveId(channel.id)}>
                <Icon name="hash" size={15} />{channel.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="chat-members">
          <span className="eyebrow">{data.members.length} {data.members.length === 1 ? 'member' : 'members'}</span>
          <div className="avatar-stack">{data.members.slice(0, 6).map((member) => <Avatar key={member.id} name={member.fullName} size="sm" />)}</div>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          <div>
            <h2><Icon name="hash" size={17} />{active?.name || '…'}</h2>
            {active?.description && <p>{active.description}</p>}
          </div>
          {isManager && active && active.name !== 'general' && <IconButton icon="trash" label={`Delete #${active.name}`} onClick={() => deleteChannel(active)} />}
        </header>
        <div
          className="chat-messages"
          ref={scroller}
          onScroll={(event) => {
            const element = event.currentTarget
            stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          }}
        >
          {!messages.length && active && (
            <div className="chat-empty">
              <span className="empty-icon"><Icon name="chat" size={22} /></span>
              <strong>This is the start of #{active.name}</strong>
              <p>Say hello to your team.</p>
            </div>
          )}
          {rows.map(({ message, day, newDay, grouped }) => {
            const mine = message.userId === account.user.id
            return (
              <div key={message.id}>
                {newDay && <div className="chat-day"><span>{day}</span></div>}
                <div className={`message${grouped ? ' grouped' : ''}${mine ? ' mine' : ''}`}>
                  {grouped ? <span className="message-gutter">{formatTime(message.createdAt)}</span> : <Avatar name={message.userName || 'Former member'} size="sm" />}
                  <div>
                    {!grouped && <div className="message-meta"><strong>{message.userName || 'Former member'}</strong><span>{formatTime(message.createdAt)}</span></div>}
                    <p>{message.body}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <form className="composer" onSubmit={send}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) send(event)
            }}
            placeholder={active ? `Message #${active.name}` : 'Select a channel'}
            rows={1}
            maxLength={4000}
            disabled={!active}
            aria-label="Message"
          />
          <button type="submit" className="btn btn-primary btn-icon" disabled={!draft.trim() || sending} aria-label="Send message"><Icon name="send" size={17} /></button>
        </form>
      </section>
      {creating && <NewChannel onClose={() => setCreating(false)} onCreated={(channel) => {
        setChannels((current) => [...current, channel])
        setActiveId(channel.id)
        toast(`#${channel.name} created`)
      }} />}
    </div>
  )
}

export default Chat

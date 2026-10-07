import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Field, IconButton, Modal } from '../../components/ui.jsx'
import { api, directUpload } from '../../lib/api.js'
import { formatBytes, formatTime } from '../../lib/format.js'
import { downloadZip } from '../../lib/zip.js'
import { looksLikeVideo } from '../../../shared/media.js'
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

function NewMessage({ members, me, onClose, onPick }) {
  const [query, setQuery] = useState('')
  const people = members
    .filter((member) => member.id !== me)
    .filter((member) => `${member.fullName} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <Modal title="New message" eyebrow="Direct message" onClose={onClose} width={460}>
      <div className="modal-body">
        <label className="ws-search dm-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teammates…" aria-label="Search teammates" />
        </label>
        <ul className="dm-picker">
          {people.map((member) => (
            <li key={member.id}>
              <button type="button" onClick={() => onPick(member)}>
                <Avatar name={member.fullName} size="sm" />
                <span><strong>{member.fullName}</strong><small>{member.email}</small></span>
                <em>{member.role}</em>
              </button>
            </li>
          ))}
          {!people.length && <li className="muted-note">{members.length > 1 ? 'No teammates match.' : 'Invite teammates from Settings → Team to start a conversation.'}</li>}
        </ul>
      </div>
    </Modal>
  )
}

function Chat() {
  const { account, isManager, toast, confirm, data, reload, params, openPayment, role } = useWorkspace()
  const [history, setHistory] = useState(null)
  const me = account.user.id
  const [channels, setChannels] = useState([])
  const [conversations, setConversations] = useState([])
  const [active, setActive] = useState(null) // { kind: 'channel' | 'dm', id }
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState(false)
  const [attaching, setAttaching] = useState('')
  const [zipping, setZipping] = useState('')
  const fileInput = useRef(null)
  const scroller = useRef(null)
  const stickToBottom = useRef(true)

  const channel = active?.kind === 'channel' ? channels.find((item) => item.id === active.id) : null
  const conversation = active?.kind === 'dm' ? conversations.find((item) => item.id === active.id) : null
  const base = active ? (active.kind === 'channel' ? `/api/channels/${active.id}` : `/api/dms/${active.id}`) : null

  const loadConversations = useCallback(async () => {
    const result = await api('/api/dms')
    setConversations(result.conversations)
  }, [])

  useEffect(() => {
    Promise.all([api('/api/channels'), loadConversations()])
      .then(([result]) => {
        setChannels(result.channels)
        // Deep links from search: #/chat?channel=<id> or #/chat?conversation=<id>
        setActive((current) => current
          || (params.conversation ? { kind: 'dm', id: params.conversation } : null)
          || (params.channel && result.channels.some((item) => item.id === params.channel) ? { kind: 'channel', id: params.channel } : null)
          || (result.channels[0] ? { kind: 'channel', id: result.channels[0].id } : null))
      })
      .catch((error) => toast(error.message, 'error'))
    // Deep-link params are read once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, loadConversations])

  const openDirect = useCallback(async (userId) => {
    try {
      const result = await api('/api/dms', { method: 'POST', body: { userId } })
      await loadConversations()
      setActive({ kind: 'dm', id: result.conversation.id })
    } catch (error) {
      toast(error.message, 'error')
    }
  }, [loadConversations, toast])

  // Deep link from elsewhere in the app: #/chat?dm=<userId>
  useEffect(() => {
    if (params.dm && params.dm !== me) openDirect(params.dm)
  }, [params.dm, me, openDirect])

  const loadMessages = useCallback(async (path) => {
    const result = await api(`${path}/messages`)
    setHistory(result.olderHidden ? result.historyDays : null)
    setMessages((current) => {
      const same = current.length === result.messages.length && current.at(-1)?.id === result.messages.at(-1)?.id
      return same ? current : result.messages
    })
  }, [])

  useEffect(() => {
    if (!base) return undefined
    setMessages([])
    stickToBottom.current = true
    // Opening a DM marks it read on the server, so refresh the unread counts afterwards.
    loadMessages(base).then(() => loadConversations()).then(() => reload(['dms'])).catch((error) => toast(error.message, 'error'))
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadMessages(base).catch(() => {})
      loadConversations().catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [base, loadMessages, loadConversations, reload, toast])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight
  }, [messages])

  async function send(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !base) return
    setSending(true)
    try {
      const result = await api(`${base}/messages`, { method: 'POST', body: { body } })
      stickToBottom.current = true
      setMessages((current) => [...current, result.message])
      setDraft('')
      if (active.kind === 'dm') loadConversations().catch(() => {})
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setSending(false)
    }
  }

  // Sends a document into the conversation; any text typed goes with it as the caption.
  async function attach(fileList) {
    const file = fileList?.[0]
    if (!file || !base) return
    if (account.subscription?.features?.videos !== true && looksLikeVideo(file.name, file.type)) {
      toast('Video uploads are part of the Enterprise plan. Share a link to the video instead, or upgrade.', 'error')
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    setAttaching(`Sending ${file.name}…`)
    try {
      // Large files go straight to cloud storage when it's set up; otherwise through the API (up to 4 MB).
      let result = await directUpload(file, { target: active.kind, targetId: active.id }, {
        caption: draft.trim(),
        onProgress: (percent) => setAttaching(`Sending ${file.name}… ${percent}%`),
      })
      if (!result) {
        if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} is larger than 4 MB.`)
        const response = await fetch(`${base}/attachments`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
            'X-File-Type': file.type || 'application/octet-stream',
            'X-Caption': encodeURIComponent(draft.trim()),
          },
          body: file,
        })
        result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'The file couldn’t be sent.')
      }
      stickToBottom.current = true
      setMessages((current) => [...current, result.message])
      setDraft('')
      if (active.kind === 'dm') loadConversations().catch(() => {})
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setAttaching('')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  // Every document shared in this conversation, as one ZIP.
  async function downloadAll() {
    try {
      const { attachments } = await api(`${base}/attachments`)
      if (!attachments.length) { toast('No documents have been shared here yet.'); return }
      setZipping(`0 of ${attachments.length}…`)
      const count = await downloadZip(
        attachments.map((item) => ({ name: item.name, url: `/api/chat/attachments/${item.id}/download` })),
        `${title} - shared documents`,
        (done, total) => setZipping(`${done} of ${total}…`),
      )
      toast(`Downloaded ${count} ${count === 1 ? 'document' : 'documents'} as a ZIP`)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setZipping('')
    }
  }

  function deleteChannel(item) {
    confirm({
      title: `Delete #${item.name}?`,
      message: 'The channel and all of its messages will be permanently deleted.',
      onConfirm: async () => {
        await api(`/api/channels/${item.id}`, { method: 'DELETE' })
        const rest = channels.filter((entry) => entry.id !== item.id)
        setChannels(rest)
        setActive(rest[0] ? { kind: 'channel', id: rest[0].id } : null)
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

  const title = channel ? channel.name : conversation ? conversation.userName : '…'
  const placeholder = channel ? `Message #${channel.name}` : conversation ? `Message ${conversation.userName}` : 'Select a conversation'
  const dmClosed = conversation && !conversation.isMember

  return (
    <div className="chat">
      <aside className="chat-channels">
        <div className="chat-channels-head">
          <span className="eyebrow">Channels</span>
          {isManager && <IconButton icon="plus" label="New channel" onClick={() => setCreating(true)} />}
        </div>
        <ul>
          {channels.map((item) => (
            <li key={item.id}>
              <button type="button" className={active?.kind === 'channel' && item.id === active.id ? 'active' : ''} onClick={() => setActive({ kind: 'channel', id: item.id })}>
                <Icon name="hash" size={15} />{item.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="chat-channels-head dm-head">
          <span className="eyebrow">Direct messages</span>
          <IconButton icon="plus" label="New direct message" onClick={() => setPicking(true)} />
        </div>
        <ul className="dm-list">
          {conversations.map((item) => (
            <li key={item.id}>
              <button type="button" className={`${active?.kind === 'dm' && item.id === active.id ? 'active' : ''}${item.unread ? ' has-unread' : ''}`} onClick={() => setActive({ kind: 'dm', id: item.id })}>
                <Avatar name={item.userName} size="xs" />
                <span>{item.userName}</span>
                {item.unread > 0 && <em>{item.unread}</em>}
              </button>
            </li>
          ))}
          {!conversations.length && (
            <li><button type="button" className="dm-start" onClick={() => setPicking(true)}><Icon name="plus" size={14} />Message a teammate</button></li>
          )}
        </ul>
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          <div>
            {conversation ? (
              <h2 className="dm-title"><Avatar name={conversation.userName} size="sm" />{title}</h2>
            ) : <h2><Icon name="hash" size={17} />{title}</h2>}
            {channel?.description && <p>{channel.description}</p>}
            {conversation && <p><Icon name="vault" size={12} /> Private — only you and {conversation.userName.split(' ')[0]} can see this conversation.</p>}
          </div>
          <div className="chat-head-actions">
            {(channel || conversation) && <Button size="sm" icon="download" onClick={downloadAll} disabled={Boolean(zipping)}>{zipping ? `Preparing ${zipping}` : 'Download all files'}</Button>}
            {isManager && channel && channel.name !== 'general' && <IconButton icon="trash" label={`Delete #${channel.name}`} onClick={() => deleteChannel(channel)} />}
          </div>
        </header>
        <div
          className="chat-messages"
          ref={scroller}
          onScroll={(event) => {
            const element = event.currentTarget
            stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          }}
        >
          {!messages.length && (channel || conversation) && (
            <div className="chat-empty">
              {conversation ? <Avatar name={conversation.userName} /> : <span className="empty-icon"><Icon name="chat" size={22} /></span>}
              <strong>{conversation ? `This is the start of your conversation with ${conversation.userName}` : `This is the start of #${channel.name}`}</strong>
              <p>{conversation ? 'Messages here are private between the two of you.' : 'Say hello to your team.'}</p>
            </div>
          )}
          {history && (
            <p className="chat-history-note">
              <Icon name="clock" size={14} />Messages older than {history} days are hidden on the Free plan.
              {['owner', 'admin'].includes(role) && <button type="button" className="text-link" onClick={openPayment}>Upgrade to see all</button>}
            </p>
          )}
          {rows.map(({ message, day, newDay, grouped }) => {
            const mine = message.userId === me
            return (
              <div key={message.id}>
                {newDay && <div className="chat-day"><span>{day}</span></div>}
                <div className={`message${grouped ? ' grouped' : ''}${mine ? ' mine' : ''}`}>
                  {grouped ? <span className="message-gutter">{formatTime(message.createdAt)}</span> : <Avatar name={message.userName || 'Former member'} size="sm" />}
                  <div>
                    {!grouped && <div className="message-meta"><strong>{message.userName || 'Former member'}</strong><span>{formatTime(message.createdAt)}</span></div>}
                    {!(message.attachment && message.body === `Shared ${message.attachment.name}`) && <p>{message.body}</p>}
                    {message.attachment && (
                      <a className="chat-file" href={`/api/chat/attachments/${message.attachment.id}/download`} download>
                        <span className="chat-file-icon"><Icon name="files" size={18} /></span>
                        <span><strong>{message.attachment.name}</strong><small>{formatBytes(message.attachment.sizeBytes)} · Download</small></span>
                        <Icon name="download" size={16} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {dmClosed ? (
          <div className="composer composer-closed">{conversation.userName} is no longer in this workspace.</div>
        ) : (
          <form className="composer" onSubmit={send}>
            <input ref={fileInput} type="file" hidden onChange={(event) => attach(event.target.files)} />
            <button type="button" className="btn btn-icon composer-attach" onClick={() => fileInput.current?.click()} disabled={!active || Boolean(attaching)} aria-label="Attach a document" title="Attach a document">
              {attaching ? <span className="spinner" /> : <Icon name="upload" size={17} />}
            </button>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) send(event)
              }}
              placeholder={placeholder}
              rows={1}
              maxLength={4000}
              disabled={!active}
              aria-label="Message"
            />
            <button type="submit" className="btn btn-primary btn-icon" disabled={!draft.trim() || sending} aria-label="Send message"><Icon name="send" size={17} /></button>
          </form>
        )}
      </section>
      {creating && <NewChannel onClose={() => setCreating(false)} onCreated={(item) => {
        setChannels((current) => [...current, item])
        setActive({ kind: 'channel', id: item.id })
        toast(`#${item.name} created`)
      }} />}
      {picking && <NewMessage members={data.members} me={me} onClose={() => setPicking(false)} onPick={(member) => {
        setPicking(false)
        openDirect(member.id)
      }} />}
    </div>
  )
}

export default Chat

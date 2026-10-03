import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Button, Empty, PageHeader, Segmented } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

function Notifications() {
  const { data, reload, navigate, toast } = useWorkspace()
  const [filter, setFilter] = useState('all')
  const unread = data.notifications.filter((item) => !item.readAt)
  const items = filter === 'unread' ? unread : data.notifications

  async function markRead(notification) {
    if (notification.readAt) return
    try {
      await api(`/api/notifications/${notification.id}/read`, { method: 'PATCH' })
      await reload(['notifications'])
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  async function markAll() {
    try {
      await api('/api/notifications/read-all', { method: 'POST' })
      await reload(['notifications'])
      toast('All caught up')
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  function open(notification) {
    markRead(notification)
    if (notification.resourceType === 'task') navigate('tasks')
  }

  return (
    <div className="stack narrow">
      <PageHeader eyebrow="Collaborate / Notifications" title="Notifications" description="Assignments, completed work and team changes that involve you.">
        {unread.length > 0 && <Button icon="check" onClick={markAll}>Mark all as read</Button>}
      </PageHeader>
      <Segmented label="Filter notifications" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: data.notifications.length },
        { value: 'unread', label: 'Unread', count: unread.length },
      ]} />
      {items.length ? (
        <ul className="card notification-list">
          {items.map((notification) => (
            <li key={notification.id} className={notification.readAt ? '' : 'unread'}>
              <span className="note-icon"><Icon name={notification.resourceType === 'task' ? 'tasks' : 'team'} size={16} /></span>
              <button type="button" className="note-body" onClick={() => open(notification)}>
                <strong>{notification.title}</strong>
                {notification.message && <p>{notification.message}</p>}
                <small>{timeAgo(notification.createdAt)}</small>
              </button>
              {!notification.readAt && <button type="button" className="text-link" onClick={() => markRead(notification)}>Mark read</button>}
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="bell" title="You’re all caught up">New assignments and updates for you will appear here.</Empty>
      )}
    </div>
  )
}

export default Notifications

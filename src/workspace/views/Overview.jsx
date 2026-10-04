import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import ActivityChart from '../../components/ActivityChart.jsx'
import { Avatar, Button, Empty, Meter, Pill } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { dueLabel, formatBytes, formatDateTime, greeting, timeAgo } from '../../lib/format.js'
import { industryFor, itemName } from '../../../shared/industries.js'
import { useWorkspace } from '../context.js'
import { SheetIcon } from './Sheets.jsx'

const WIDGETS = {
  tasks: 'My tasks',
  upcoming: 'Coming up',
  recent: 'Recently updated',
  activity: 'Recent activity',
  chart: 'Business activity',
  storage: 'Storage',
}
const DEFAULT_LAYOUT = ['tasks', 'upcoming', 'recent', 'activity', 'chart', 'storage']

// Each person arranges their own home; the layout lives in this browser.
function useLayout(userId) {
  const key = `ovo.home.${userId}`
  const [layout, setLayout] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key))
      if (Array.isArray(saved)) return saved.filter((item) => WIDGETS[item])
    } catch {
      // Fall through to the default layout.
    }
    return DEFAULT_LAYOUT
  })
  const save = (next) => {
    setLayout(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* private mode: layout lasts this visit */ }
  }
  return [layout, save]
}

function Tile({ icon, tone, value, label, note, href }) {
  return (
    <a className={`home-tile tone-${tone}`} href={href}>
      <span className="home-tile-icon"><Icon name={icon} size={18} /></span>
      <strong>{value ?? '—'}</strong>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </a>
  )
}

function Overview() {
  const { account, data, isManager, isAdmin, patch, openForm, loaded, navigate } = useWorkspace()
  const [layout, setLayout] = useLayout(account.user.id)
  const [editing, setEditing] = useState(false)
  const [recent, setRecent] = useState(null)
  const [now] = useState(() => Date.now())
  const dashboard = data.dashboard
  const stats = dashboard?.stats || {}
  const industry = industryFor(account.organization.industry)
  const modules = data.sheets.filter((sheet) => sheet.pinned)

  useEffect(() => {
    api('/api/records/recent').then((result) => setRecent(result.records)).catch(() => setRecent([]))
  }, [])

  const myTasks = data.tasks.filter((task) => task.status !== 'Completed' && task.assigneeId === account.user.id).slice(0, 6)
  const upcoming = data.events.filter((event) => new Date(event.startsAt) >= new Date(now - 3_600_000)).slice(0, 5)
  const trial = account.subscription
  const trialDays = trial?.status === 'trial' && trial.trialEndsAt ? Math.max(0, Math.ceil((new Date(trial.trialEndsAt) - now) / 86_400_000)) : null
  const clientsLabel = industry.clientLabel || 'Clients'
  const showClients = isManager && industry.core.includes('clients')
  const showProjects = isManager && industry.core.includes('projects')

  // Tiles: the business's own modules first, then the core work.
  const tiles = [
    ...modules.slice(0, 4).map((sheet) => ({ key: sheet.id, icon: sheet.icon, tone: sheet.color, value: sheet.rowCount.toLocaleString(), label: sheet.name, href: `#/sheet?id=${sheet.id}` })),
    showClients && { key: 'clients', icon: 'clients', tone: 'pink', value: stats.clients, label: clientsLabel, href: '#/clients' },
    showProjects && { key: 'projects', icon: 'projects', tone: 'blue', value: stats.projects, label: 'Active projects', href: '#/projects' },
    { key: 'tasks', icon: 'tasks', tone: 'green', value: stats.tasks, label: isManager ? 'Open tasks' : 'My open tasks', note: `${stats.tasksDueThisWeek ?? 0} due this week`, href: '#/tasks' },
    { key: 'events', icon: 'calendar', tone: 'amber', value: upcoming.length, label: 'Coming up', href: '#/calendar' },
  ].filter(Boolean).slice(0, 6)

  const quick = [
    ...modules.slice(0, 3).map((sheet) => ({ label: `Add ${itemName(sheet).toLowerCase()}`, icon: sheet.icon, tone: sheet.color, run: () => navigate('sheet', { id: sheet.id, add: Date.now() }) })),
    showClients && { label: `Add ${clientsLabel.replace(/s$/, '').toLowerCase()}`, icon: 'clients', tone: 'pink', run: () => openForm('client') },
    isManager && { label: 'New task', icon: 'tasks', tone: 'green', run: () => openForm('task') },
    { label: 'Create sheet', icon: 'sheet', tone: 'teal', run: () => navigate('sheets') },
    { label: 'Upload document', icon: 'upload', tone: 'sky', run: () => navigate('files') },
    { label: 'Send message', icon: 'chat', tone: 'violet', run: () => navigate('chat') },
  ].filter(Boolean).slice(0, 7)

  function move(key, step) {
    const index = layout.indexOf(key)
    const next = [...layout]
    const target = index + step
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setLayout(next)
  }

  const widgets = {
    tasks: (
      <>
        <div className="card-head">
          <div><h2>My tasks</h2><p>Assigned to you and still open.</p></div>
          <a className="text-link" href="#/tasks">All tasks <Icon name="right" size={14} /></a>
        </div>
        {myTasks.length ? (
          <ul className="task-checklist">
            {myTasks.map((task) => {
              const due = dueLabel(task.dueDate)
              return (
                <li key={task.id}>
                  <button type="button" className="check" aria-label={`Mark “${task.title}” complete`}
                    onClick={() => patch(`/api/tasks/${task.id}`, { status: 'Completed' }, ['tasks', 'dashboard', 'projects'], 'Task completed')} />
                  <div><span>{task.title}</span><small>{task.projectName || 'No project'}</small></div>
                  {due && <Pill tone={due.tone}>{due.text}</Pill>}
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty icon="tasks" title="Nothing on your plate">{isManager ? 'Create a task and assign it to yourself or a teammate.' : 'Tasks assigned to you will appear here.'}</Empty>
        )}
      </>
    ),
    upcoming: (
      <>
        <div className="card-head">
          <div><h2>Coming up</h2><p>From the team calendar.</p></div>
          <a className="text-link" href="#/calendar">Calendar <Icon name="right" size={14} /></a>
        </div>
        {upcoming.length ? (
          <ul className="agenda">
            {upcoming.map((event) => (
              <li key={event.id}>
                <div className="agenda-date"><strong>{new Date(event.startsAt).getDate()}</strong><span>{new Date(event.startsAt).toLocaleDateString(undefined, { month: 'short' })}</span></div>
                <div><span>{event.title}</span><small>{formatDateTime(event.startsAt)}{event.projectName ? ` · ${event.projectName}` : ''}</small></div>
                <Pill>{event.eventType}</Pill>
              </li>
            ))}
          </ul>
        ) : <Empty icon="calendar" title="A clear schedule">Meetings, viewings and deadlines you schedule appear here.</Empty>}
      </>
    ),
    recent: (
      <>
        <div className="card-head">
          <div><h2>Recently updated</h2><p>The latest changes to your records.</p></div>
          <a className="text-link" href="#/sheets">Sheets <Icon name="right" size={14} /></a>
        </div>
        {recent?.length ? (
          <ul className="recent-list">
            {recent.map((record) => (
              <li key={record.id}>
                <a href={`#/sheet?id=${record.sheetId}&record=${record.id}`}>
                  <SheetIcon icon={record.icon} color={record.color} size="sm" />
                  <span><strong>{record.title || 'Untitled record'}</strong><small>{record.sheetName} · {record.updatedBy || 'Someone'} · {timeAgo(record.updatedAt)}</small></span>
                </a>
              </li>
            ))}
          </ul>
        ) : <Empty icon="sheet" title="No records yet">Records you add to your sheets will show up here.</Empty>}
      </>
    ),
    activity: (
      <>
        <div className="card-head"><div><h2>Recent activity</h2><p>What your team has been doing.</p></div></div>
        <ul className="activity">
          {(dashboard?.activity || []).slice(0, 6).map((entry) => (
            <li key={entry.id}>
              <Avatar name={entry.user} size="sm" />
              <div><p><strong>{entry.user}</strong> {entry.action} <strong>{entry.object}</strong></p><small>{timeAgo(entry.time)}</small></div>
            </li>
          ))}
        </ul>
        {loaded && !dashboard?.activity?.length && <p className="muted-note">Activity from your team shows up here.</p>}
      </>
    ),
    chart: (
      <>
        <div className="card-head"><div><h2>Business activity</h2><p>Updates across your workspace, week by week.</p></div></div>
        {dashboard ? <ActivityChart weeks={dashboard.weeklyActivity} unit="updates" /> : <div className="chart-skeleton" />}
      </>
    ),
    storage: (
      <>
        <div className="card-head">
          <div><h2>Storage</h2><p>{formatBytes(stats.storageUsedBytes)} of {formatBytes(stats.storageLimitBytes)} used</p></div>
          <a className="text-link" href="#/files">Files <Icon name="right" size={14} /></a>
        </div>
        <Meter value={stats.storageUsedBytes || 0} max={stats.storageLimitBytes || 1} />
      </>
    ),
  }

  const hidden = Object.keys(WIDGETS).filter((key) => !layout.includes(key))

  return (
    <div className="stack home">
      <section className="home-hero">
        <div className="home-hero-text">
          <span className="home-date">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <h1>{greeting()}, {account.organization.name}</h1>
          <p>Welcome back, {account.user.fullName.split(' ')[0]}. Here’s what matters today.</p>
          {isAdmin && trialDays !== null && <a href="#/billing" className="trial-chip">{trialDays} days left in your trial</a>}
        </div>
        <div className="home-quick" aria-label="Quick actions">
          {quick.map((item) => (
            <button key={item.label} type="button" onClick={item.run}>
              <span className={`create-icon tone-${item.tone}`}><Icon name={item.icon} size={16} /></span>
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="home-tiles" aria-label="Today's overview">
        {tiles.map(({ key, ...tile }) => <Tile key={key} {...tile} />)}
      </section>

      <div className="home-bar">
        <h2>Your dashboard</h2>
        <Button size="sm" icon={editing ? 'check' : 'layout'} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Customize'}</Button>
      </div>
      {editing && hidden.length > 0 && (
        <div className="home-hidden">
          <span>Hidden:</span>
          {hidden.map((key) => <button key={key} type="button" className="chip tone-slate" onClick={() => setLayout([...layout, key])}><Icon name="plus" size={12} />{WIDGETS[key]}</button>)}
        </div>
      )}
      <section className="home-widgets">
        {layout.map((key, index) => (
          <div key={key} className={`card widget widget-${key}${editing ? ' editing' : ''}`}>
            {editing && (
              <div className="widget-tools">
                <span>{WIDGETS[key]}</span>
                <button type="button" aria-label="Move earlier" disabled={!index} onClick={() => move(key, -1)}><Icon name="up" size={14} /></button>
                <button type="button" aria-label="Move later" disabled={index === layout.length - 1} onClick={() => move(key, 1)}><Icon name="down" size={14} /></button>
                <button type="button" aria-label="Hide" onClick={() => setLayout(layout.filter((item) => item !== key))}><Icon name="eye" size={14} /></button>
              </div>
            )}
            {widgets[key]}
          </div>
        ))}
      </section>
    </div>
  )
}

export default Overview

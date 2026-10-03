import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Empty, Meter, Pill } from '../../components/ui.jsx'
import { dueLabel, formatBytes, formatDateTime, greeting, timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

function StatTile({ label, value, note, href }) {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value ?? '—'}</strong>
      {note && <span className="stat-note">{note}</span>}
    </>
  )
  return href ? <a className="stat-tile" href={href}>{content}</a> : <div className="stat-tile">{content}</div>
}

function ActivityChart({ weeks }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(4, ...weeks.map((week) => week.count))
  const step = Math.ceil(max / 4)
  const top = step * 4
  const ticks = [0, step, step * 2, step * 3, top]
  const width = 640
  const height = 180
  const left = 28
  const bottom = 22
  const plotWidth = width - left
  const plotHeight = height - bottom - 8
  const band = plotWidth / weeks.length
  const barWidth = Math.min(24, band * 0.56)
  const total = weeks.reduce((sum, week) => sum + week.count, 0)
  const label = (week) => new Date(`${week}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Workspace activity per week for the last 12 weeks, ${total} updates in total`}>
        {ticks.map((tick) => {
          const y = 8 + plotHeight - (tick / top) * plotHeight
          return (
            <g key={tick}>
              <line x1={left} x2={width} y1={y} y2={y} className="chart-grid" />
              <text x={left - 8} y={y + 3.5} textAnchor="end" className="chart-tick">{tick}</text>
            </g>
          )
        })}
        {weeks.map((week, index) => {
          const barHeight = week.count ? Math.max(3, (week.count / top) * plotHeight) : 0
          const x = left + band * index + (band - barWidth) / 2
          const y = 8 + plotHeight - barHeight
          const r = Math.min(4, barHeight / 2)
          const isLast = index === weeks.length - 1
          return (
            <g key={week.week} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
              <rect x={left + band * index} y={0} width={band} height={height - bottom} fill="transparent" />
              {barHeight > 0 && (
                <path
                  className={`chart-bar${isLast ? ' current' : ''}${hover === index ? ' hover' : ''}`}
                  d={`M${x},${y + barHeight} V${y + r} Q${x},${y} ${x + r},${y} H${x + barWidth - r} Q${x + barWidth},${y} ${x + barWidth},${y + r} V${y + barHeight} Z`}
                />
              )}
              {(index % 3 === 2 || isLast) && (
                <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" className="chart-tick">{isLast ? 'This week' : label(week.week)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${((left + band * hover + band / 2) / width) * 100}%` }}>
          <strong>{weeks[hover].count} updates</strong>
          <span>Week of {label(weeks[hover].week)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>Workspace updates per week</caption>
        <tbody>{weeks.map((week) => <tr key={week.week}><th>{label(week.week)}</th><td>{week.count}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}

function Overview() {
  const { account, data, isManager, isAdmin, patch, openForm, loaded } = useWorkspace()
  const dashboard = data.dashboard
  const stats = dashboard?.stats || {}
  const [now] = useState(() => Date.now())
  const firstName = account.user.fullName.split(' ')[0]
  const myTasks = data.tasks
    .filter((task) => task.status !== 'Completed' && task.assigneeId === account.user.id)
    .slice(0, 6)
  const upcoming = data.events.filter((event) => new Date(event.startsAt) >= new Date(now - 3_600_000)).slice(0, 5)
  const trial = account.subscription
  const trialDays = trial?.status === 'trial' && trial.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trial.trialEndsAt) - now) / 86_400_000))
    : null

  return (
    <div className="stack">
      <section className="overview-head">
        <div>
          <span className="eyebrow">{greeting()}, {firstName}</span>
          <h1>Here’s your workspace at a glance.</h1>
        </div>
        <div className="overview-meta">
          <span>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          {isAdmin && trialDays !== null && <a href="#/billing" className="trial-chip">{trialDays} days left in trial</a>}
        </div>
      </section>

      <section className="stat-grid">
        {isManager ? <>
          <StatTile label="Active projects" value={stats.projects} note={`${data.projects.length} in total`} href="#/projects" />
          <StatTile label="Open tasks" value={stats.tasks} note={`${stats.tasksDueThisWeek ?? 0} due this week`} href="#/tasks" />
          <StatTile label="Clients" value={stats.clients} note={stats.clientIndustries ? `Across ${stats.clientIndustries} ${stats.clientIndustries === 1 ? 'industry' : 'industries'}` : 'Add your first client'} href="#/clients" />
          <StatTile label="Team" value={stats.members} note={isAdmin ? 'Invite from Settings' : 'Workspace members'} href="#/settings?tab=team" />
        </> : <>
          <StatTile label="My open tasks" value={stats.tasks} note={`${stats.tasksDueThisWeek ?? 0} due this week`} href="#/tasks" />
          <StatTile label="Upcoming events" value={upcoming.length} note="On the team calendar" href="#/calendar" />
          <StatTile label="Team" value={stats.members} note="Workspace members" />
          <StatTile label="Storage used" value={formatBytes(stats.storageUsedBytes)} note={`of ${formatBytes(stats.storageLimitBytes)}`} href="#/files" />
        </>}
      </section>

      <section className="grid-2-1">
        <div className="card">
          <div className="card-head">
            <div><h2>Workspace activity</h2><p>Updates across projects, tasks, clients and files per week.</p></div>
          </div>
          {dashboard ? <ActivityChart weeks={dashboard.weeklyActivity} /> : <div className="chart-skeleton" />}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Recent activity</h2></div></div>
          <ul className="activity">
            {(dashboard?.activity || []).slice(0, 5).map((entry) => (
              <li key={entry.id}>
                <Avatar name={entry.user} size="sm" />
                <div>
                  <p><strong>{entry.user}</strong> {entry.action} <strong>{entry.object}</strong></p>
                  <small>{timeAgo(entry.time)}</small>
                </div>
              </li>
            ))}
          </ul>
          {loaded && !dashboard?.activity?.length && <p className="muted-note">Activity from your team shows up here.</p>}
        </div>
      </section>

      <section className="grid-1-1">
        <div className="card">
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
                    <button
                      type="button"
                      className="check"
                      aria-label={`Mark “${task.title}” complete`}
                      onClick={() => patch(`/api/tasks/${task.id}`, { status: 'Completed' }, ['tasks', 'dashboard', 'projects'], 'Task completed')}
                    />
                    <div>
                      <span>{task.title}</span>
                      <small>{task.projectName || 'No project'}</small>
                    </div>
                    {due && <Pill tone={due.tone}>{due.text}</Pill>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <Empty icon="tasks" title="Nothing on your plate">
              {isManager ? 'Create a task and assign it to yourself or a teammate.' : 'Tasks assigned to you will appear here.'}
            </Empty>
          )}
          {isManager && !myTasks.length && <div className="card-foot"><Button variant="primary" icon="plus" size="sm" onClick={() => openForm('task', { assigneeId: account.user.id })}>New task</Button></div>}
        </div>
        <div className="card">
          <div className="card-head">
            <div><h2>Coming up</h2><p>From the team calendar.</p></div>
            <a className="text-link" href="#/calendar">Calendar <Icon name="right" size={14} /></a>
          </div>
          {upcoming.length ? (
            <ul className="agenda">
              {upcoming.map((event) => (
                <li key={event.id}>
                  <div className="agenda-date">
                    <strong>{new Date(event.startsAt).getDate()}</strong>
                    <span>{new Date(event.startsAt).toLocaleDateString(undefined, { month: 'short' })}</span>
                  </div>
                  <div>
                    <span>{event.title}</span>
                    <small>{formatDateTime(event.startsAt)}{event.projectName ? ` · ${event.projectName}` : ''}</small>
                  </div>
                  <Pill>{event.eventType}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="calendar" title="A clear schedule">Meetings and milestones you schedule will appear here.</Empty>
          )}
        </div>
      </section>
      <div className="storage-row">
        <div>
          <span className="eyebrow">Storage</span>
          <strong>{formatBytes(stats.storageUsedBytes)} <span>of {formatBytes(stats.storageLimitBytes)}</span></strong>
        </div>
        <Meter value={stats.storageUsedBytes || 0} max={stats.storageLimitBytes || 1} />
        <a className="text-link" href="#/files">Open files <Icon name="right" size={14} /></a>
      </div>
    </div>
  )
}

export default Overview

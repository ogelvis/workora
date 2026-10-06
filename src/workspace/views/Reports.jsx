import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Empty, PageHeader, Segmented } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { formatTime, timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'
import { ProgressBar } from './Tasks.jsx'

// ---------------------------------------------------------------- Dates (in the viewer's own time zone)
const pad = (number) => String(number).padStart(2, '0')
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
function parseDay(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}
function mondayOf(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7))
  return copy
}
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const longDay = (date) => date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const weekLabel = (monday) => `${monday.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(monday, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`

function Stepper({ label, onPrev, onNext, nextDisabled }) {
  return (
    <div className="rp-stepper">
      <button type="button" className="icon-btn" onClick={onPrev} aria-label="Previous"><Icon name="left" size={16} /></button>
      <strong>{label}</strong>
      <button type="button" className="icon-btn" onClick={onNext} disabled={nextDisabled} aria-label="Next"><Icon name="right" size={16} /></button>
    </div>
  )
}

// ---------------------------------------------------------------- Daily: what everyone did today
function Daily() {
  const { toast, navigate } = useWorkspace()
  const [day, setDay] = useState(() => dayKey(new Date()))
  const [data, setData] = useState(null)
  const date = parseDay(day)
  const isToday = day === dayKey(new Date())

  useEffect(() => {
    setData(null)
    const query = new URLSearchParams({ from: date.toISOString(), to: addDays(date, 1).toISOString() })
    api(`/api/reports/daily?${query}`).then(setData).catch((error) => toast(error.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, toast])

  if (!data) return <div className="card chart-skeleton" />
  const byPerson = new Map()
  for (const update of data.updates) {
    if (!byPerson.has(update.userId)) byPerson.set(update.userId, [])
    byPerson.get(update.userId).push(update)
  }
  const reported = data.people.filter((person) => byPerson.has(person.id))
  const silent = data.people.filter((person) => !byPerson.has(person.id) && person.openTasks > 0)
  const completed = data.updates.filter((update) => update.progress === 100).length

  return (
    <div className="stack">
      <div className="rp-bar">
        <Stepper label={isToday ? `Today · ${longDay(date)}` : longDay(date)} onPrev={() => setDay(dayKey(addDays(date, -1)))} onNext={() => setDay(dayKey(addDays(date, 1)))} nextDisabled={isToday} />
      </div>
      <div className="rp-tiles">
        <div className="rp-tile"><strong>{data.updates.length}</strong><span>updates posted</span></div>
        <div className="rp-tile"><strong>{reported.length}<em>/{data.people.length}</em></strong><span>people reported</span></div>
        <div className="rp-tile good"><strong>{completed}</strong><span>tasks finished</span></div>
        <div className="rp-tile warn"><strong>{data.people.reduce((sum, person) => sum + person.overdue, 0)}</strong><span>tasks overdue</span></div>
      </div>
      {silent.length > 0 && (
        <section className="card rp-silent">
          <div className="card-head"><div><h2>No update {isToday ? 'yet today' : 'that day'}</h2><p>These people have open tasks but haven’t posted progress.</p></div></div>
          <ul>
            {silent.map((person) => (
              <li key={person.id}>
                <Avatar name={person.fullName} size="sm" />
                <div><strong>{person.fullName}</strong><small>{person.openTasks} open {person.openTasks === 1 ? 'task' : 'tasks'} · average {person.averageProgress}%{person.overdue ? ` · ${person.overdue} overdue` : ''} · last update {person.lastUpdateAt ? timeAgo(person.lastUpdateAt) : 'never'}</small></div>
                <Button size="sm" icon="chat" onClick={() => navigate('chat', { dm: person.id })}>Message</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!reported.length ? (
        <Empty icon="chart" title={isToday ? 'No updates yet today' : 'No updates that day'}>When your team posts progress on their tasks, it shows up here, person by person.</Empty>
      ) : reported.map((person) => (
        <section key={person.id} className="card rp-person">
          <div className="rp-person-head">
            <Avatar name={person.fullName} />
            <div><strong>{person.fullName}</strong><small>{byPerson.get(person.id).length} {byPerson.get(person.id).length === 1 ? 'update' : 'updates'} · {person.openTasks} open {person.openTasks === 1 ? 'task' : 'tasks'} · average {person.averageProgress}%</small></div>
          </div>
          <ul className="rp-updates">
            {byPerson.get(person.id).map((update) => (
              <li key={update.id}>
                <div className="rp-update-top">
                  <strong>{update.taskTitle}</strong>
                  <span className="muted">{update.projectName ? `${update.projectName} · ` : ''}{formatTime(update.createdAt)}</span>
                </div>
                <ProgressBar value={update.progress} />
                {update.note && <p>{update.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Weekly: everyone's reports
const SECTIONS = [
  { key: 'done', label: 'Tasks done', icon: 'check', tone: 'green' },
  { key: 'pending', label: 'Tasks pending', icon: 'clock', tone: 'amber' },
  { key: 'delays', label: 'Reasons for delays', icon: 'alert', tone: 'rose' },
  { key: 'remaining', label: 'What’s remaining', icon: 'right', tone: 'blue' },
]

function ReportCard({ report }) {
  return (
    <article className="card rp-report">
      <div className="rp-person-head">
        <Avatar name={report.userName} />
        <div>
          <strong>{report.userName}</strong>
          <small>Submitted {timeAgo(report.submittedAt)}{report.edited ? ` · edited ${timeAgo(report.updatedAt)}` : ''}</small>
        </div>
        {report.edited && <span className="rp-edited">Edited</span>}
      </div>
      <div className="rp-sections">
        {SECTIONS.map((section) => (
          <div key={section.key} className={`rp-section tone-${section.tone}`}>
            <span className="rp-section-label"><Icon name={section.icon} size={14} />{section.label}</span>
            <p>{report[section.key] || <span className="muted">—</span>}</p>
          </div>
        ))}
      </div>
    </article>
  )
}

function TeamWeekly() {
  const { toast, navigate } = useWorkspace()
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [data, setData] = useState(null)
  const thisWeek = dayKey(monday) === dayKey(mondayOf(new Date()))

  useEffect(() => {
    setData(null)
    api(`/api/reports/weekly?week=${dayKey(monday)}`).then(setData).catch((error) => toast(error.message, 'error'))
  }, [monday, toast])

  return (
    <div className="stack">
      <div className="rp-bar">
        <Stepper label={`${thisWeek ? 'This week · ' : ''}${weekLabel(monday)}`} onPrev={() => setMonday(addDays(monday, -7))} onNext={() => setMonday(addDays(monday, 7))} nextDisabled={thisWeek} />
        {data && <span className="rp-count"><b>{data.reports.length}</b> of {data.reports.length + data.missing.length} submitted</span>}
      </div>
      {!data ? <div className="card chart-skeleton" /> : <>
        {data.missing.length > 0 && (
          <section className="card rp-silent">
            <div className="card-head"><div><h2>Not submitted yet</h2><p>{thisWeek ? 'They can still send this week’s report from Reports → My weekly report.' : 'No report was sent for this week.'}</p></div></div>
            <ul>
              {data.missing.map((person) => (
                <li key={person.id}>
                  <Avatar name={person.fullName} size="sm" />
                  <div><strong>{person.fullName}</strong><small>{person.role.charAt(0).toUpperCase() + person.role.slice(1)}</small></div>
                  <Button size="sm" icon="chat" onClick={() => navigate('chat', { dm: person.id })}>Remind</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.reports.length ? data.reports.map((report) => <ReportCard key={report.id} report={report} />)
          : <Empty icon="notes" title="No weekly reports yet">Reports appear here as your team submits them.</Empty>}
      </>}
    </div>
  )
}

// ---------------------------------------------------------------- My weekly report
function MyWeekly() {
  const { toast } = useWorkspace()
  const [monday, setMonday] = useState(() => mondayOf(new Date()))
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({ done: '', pending: '', delays: '', remaining: '' })
  const [busy, setBusy] = useState(false)
  const thisWeek = dayKey(monday) === dayKey(mondayOf(new Date()))

  const load = useCallback(() => {
    setData(null)
    return api(`/api/reports/weekly/mine?week=${dayKey(monday)}`).then((result) => {
      setData(result)
      setDraft(result.report
        ? { done: result.report.done, pending: result.report.pending, delays: result.report.delays, remaining: result.report.remaining }
        : { done: '', pending: '', delays: '', remaining: '' })
    }).catch((error) => toast(error.message, 'error'))
  }, [monday, toast])
  useEffect(() => { load() }, [load])

  function fillFromTasks() {
    const done = data.suggestions.done.map((title) => `- ${title}`).join('\n')
    const pending = data.suggestions.pending.map((task) => `- ${task.title} (${task.progress}%${task.overdue ? ', overdue' : ''})`).join('\n')
    setDraft((current) => ({ ...current, done: current.done || done, pending: current.pending || pending }))
    toast(done || pending ? 'Filled in from your tasks — edit as you like' : 'No tasks to fill in from yet')
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api('/api/reports/weekly', { method: 'PUT', body: { week: dayKey(monday), ...draft } })
      toast(data.report ? 'Report updated' : 'Weekly report submitted — thank you!')
      setData((current) => ({ ...current, report: result.report, history: [result.report, ...current.history.filter((item) => item.id !== result.report.id)] }))
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const prompts = {
    done: 'What did you finish this week?',
    pending: 'What’s still in progress?',
    delays: 'Anything that slowed you down? Why?',
    remaining: 'What’s left to do, and what’s next week’s plan?',
  }

  return (
    <div className="rp-mine">
      <form className="card rp-form" onSubmit={submit}>
        <div className="rp-form-head">
          <Stepper label={`${thisWeek ? 'This week · ' : ''}${weekLabel(monday)}`} onPrev={() => setMonday(addDays(monday, -7))} onNext={() => setMonday(addDays(monday, 7))} nextDisabled={thisWeek} />
          {data?.report
            ? <span className="rp-status sent"><Icon name="check" size={14} />Submitted {timeAgo(data.report.submittedAt)}{data.report.edited ? ' · edited' : ''}</span>
            : <span className="rp-status">Not submitted yet</span>}
        </div>
        {!data ? <div className="chart-skeleton" /> : <>
          <div className="rp-fill">
            <span>Start from your tasks: finished ones go under “done”, open ones under “pending”.</span>
            <Button size="sm" icon="sparkle" onClick={fillFromTasks}>Fill from my tasks</Button>
          </div>
          {SECTIONS.map((section) => (
            <label key={section.key} className={`rp-field tone-${section.tone}`}>
              <span className="rp-section-label"><Icon name={section.icon} size={14} />{section.label}</span>
              <textarea rows={section.key === 'delays' ? 2 : 4} maxLength={5000} value={draft[section.key]} placeholder={prompts[section.key]}
                onChange={(event) => setDraft((current) => ({ ...current, [section.key]: event.target.value }))} />
            </label>
          ))}
          <div className="rp-actions">
            {data.report && <span className="muted-note">You can still edit this report. Your manager sees when it was last changed.</span>}
            <Button type="submit" variant="primary" icon={data.report ? 'check' : 'send'} disabled={busy}>{busy ? 'Saving…' : data.report ? 'Save changes' : 'Submit report'}</Button>
          </div>
        </>}
      </form>
      {data?.history?.length > 0 && (
        <aside className="card rp-history">
          <div className="card-head"><div><h2>Your reports</h2><p>Open a week to read or edit it.</p></div></div>
          <ul>
            {data.history.map((item) => (
              <li key={item.id}>
                <button type="button" className={item.weekStart === dayKey(monday) ? 'active' : ''} onClick={() => setMonday(parseDay(item.weekStart))}>
                  <strong>{weekLabel(parseDay(item.weekStart))}</strong>
                  <small>Submitted {timeAgo(item.submittedAt)}{item.edited ? ' · edited' : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}

function Reports() {
  const { isManager, params, navigate } = useWorkspace()
  const tabs = isManager ? ['daily', 'weekly', 'mine'] : ['mine']
  const tab = tabs.includes(params.tab) ? params.tab : tabs[0]
  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Reports" title={isManager ? 'Team reports' : 'My weekly report'}
        description={isManager ? 'See what everyone did today, read weekly reports and spot delays early.' : 'Tell your manager what you finished, what’s pending, what slowed you down and what’s next.'} />
      {isManager && (
        <div className="rp-tabs"><Segmented label="Report type" value={tab} onChange={(next) => navigate('reports', { tab: next })} options={[
          { value: 'daily', label: 'Daily updates', icon: 'chart' },
          { value: 'weekly', label: 'Weekly reports', icon: 'notes' },
          { value: 'mine', label: 'My weekly report', icon: 'edit' },
        ]} /></div>
      )}
      {tab === 'daily' && <Daily />}
      {tab === 'weekly' && <TeamWeekly />}
      {tab === 'mine' && <MyWeekly />}
    </div>
  )
}

export default Reports

import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Button, Empty, IconButton, Menu, PageHeader, Pill } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { formatTime, todayKey } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

const typeTone = {
  Meeting: 'info', 'Task deadline': 'warning', 'Project deadline': 'warning', Campaign: 'success',
  'Client appointment': 'neutral', 'Company event': 'muted',
}

function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7)) // weeks start on Monday
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

function Calendar() {
  const { data, isManager, openForm, remove, toast } = useWorkspace()
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [events, setEvents] = useState([])
  const days = useMemo(() => monthGrid(month), [month])

  useEffect(() => {
    let active = true
    const from = days[0].toISOString()
    const to = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate() + 1).toISOString()
    api(`/api/calendar?${new URLSearchParams({ from, to })}`)
      .then((result) => active && setEvents(result.events))
      .catch((error) => toast(error.message, 'error'))
    return () => {
      active = false
    }
    // data.events changes whenever an event is saved, so the visible month refetches too.
  }, [days, data.events, toast])

  const byDay = useMemo(() => {
    const map = {}
    for (const event of events) (map[todayKey(new Date(event.startsAt))] ||= []).push(event)
    return map
  }, [events])

  const upcoming = data.events.filter((event) => new Date(event.startsAt) >= new Date(new Date().setHours(0, 0, 0, 0))).slice(0, 8)
  const today = todayKey()

  function newEventOn(day) {
    if (!isManager) return
    const start = new Date(day)
    start.setHours(9, 0, 0, 0)
    openForm('event', { startsAt: start.toISOString() })
  }

  function shift(delta) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1))
  }

  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Calendar" title="Calendar" description="Meetings, deadlines and milestones for the whole team.">
        {isManager && <Button variant="primary" icon="plus" onClick={() => openForm('event')}>Schedule event</Button>}
      </PageHeader>
      <div className="calendar-layout">
        <section className="card calendar-card">
          <div className="calendar-head">
            <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
            <div className="calendar-nav">
              <Button size="sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</Button>
              <IconButton icon="left" label="Previous month" onClick={() => shift(-1)} />
              <IconButton icon="right" label="Next month" onClick={() => shift(1)} />
            </div>
          </div>
          <div className="month-grid" role="grid" aria-label="Month view">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => <div key={label} className="weekday" role="columnheader">{label}</div>)}
            {days.map((day) => {
              const key = todayKey(day)
              const dayEvents = byDay[key] || []
              const outside = day.getMonth() !== month.getMonth()
              return (
                <div key={key} role="gridcell" className={`day${outside ? ' outside' : ''}${key === today ? ' today' : ''}`}>
                  <button type="button" className="day-number" onClick={() => newEventOn(day)} disabled={!isManager} aria-label={isManager ? `Schedule on ${day.toDateString()}` : day.toDateString()}>
                    {day.getDate()}
                  </button>
                  {dayEvents.slice(0, 3).map((event) => (
                    <button key={event.id} type="button" className={`day-event tone-${typeTone[event.eventType]}`}
                      onClick={() => isManager && openForm('event', event)} title={`${formatTime(event.startsAt)} ${event.title}`}>
                      {event.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 && <span className="day-more">+{dayEvents.length - 3} more</span>}
                </div>
              )
            })}
          </div>
        </section>
        <aside className="card">
          <div className="card-head"><div><h2>Upcoming</h2></div></div>
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
                    <small>
                      <Icon name="clock" size={12} /> {formatTime(event.startsAt)}{event.endsAt ? `–${formatTime(event.endsAt)}` : ''}
                      {event.projectName ? ` · ${event.projectName}` : ''}{event.clientName ? ` · ${event.clientName}` : ''}
                    </small>
                    <Pill tone={typeTone[event.eventType]}>{event.eventType}</Pill>
                  </div>
                  {isManager && <Menu items={[
                    { label: 'Edit event', icon: 'edit', onSelect: () => openForm('event', event) },
                    { label: 'Cancel event', icon: 'trash', danger: true, onSelect: () => remove('event', event) },
                  ]} />}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="calendar" title="Nothing scheduled">{isManager ? 'Click a day on the calendar to schedule something.' : 'Events your managers schedule appear here.'}</Empty>
          )}
        </aside>
      </div>
    </div>
  )
}

export default Calendar

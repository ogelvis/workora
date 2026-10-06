import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Empty, Field, Menu, Modal, PageHeader, Pill, Segmented } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { taskStatuses } from '../../lib/constants.js'
import { dueLabel, formatDateTime, timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

const priorityTone = { Low: 'muted', Medium: 'neutral', High: 'warning', Urgent: 'danger' }

function readView() {
  try {
    return localStorage.getItem('ovo.tasks.view') || 'board'
  } catch {
    return 'board'
  }
}

const isToday = (value) => value && new Date(value).toDateString() === new Date().toDateString()

export function ProgressBar({ value, small }) {
  const tone = value >= 100 ? 'done' : value >= 60 ? 'good' : value > 0 ? 'mid' : 'none'
  return (
    <div className={`task-progress${small ? ' small' : ''}`} title={`${value}% done`}>
      <div className="task-progress-track"><span className={`tp-${tone}`} style={{ width: `${value}%` }} /></div>
      <strong>{value}%</strong>
    </div>
  )
}

// Post today's progress on a task, with a short note, and see earlier updates.
export function TaskUpdateModal({ task, onClose }) {
  const { toast, reload } = useWorkspace()
  const [progress, setProgress] = useState(task.progress || 0)
  const [note, setNote] = useState('')
  const [updates, setUpdates] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api(`/api/tasks/${task.id}/updates`).then((result) => setUpdates(result.updates)).catch(() => setUpdates([]))
  }, [task.id])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await api(`/api/tasks/${task.id}/updates`, { method: 'POST', body: { progress, note } })
      toast(progress === 100 ? 'Task completed — great work!' : 'Update posted')
      await reload(['tasks', 'projects', 'dashboard'])
      onClose()
    } catch (error) {
      toast(error.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title={task.title} eyebrow="Daily update" onClose={onClose} width={560} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body stack-sm">
          <div className="field">
            <span className="field-label">How far along is it? <strong className="tu-value">{progress}%</strong></span>
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(event) => setProgress(Number(event.target.value))} className="tu-range" aria-label="Progress" />
            <div className="tu-quick">
              {[0, 25, 50, 75, 100].map((value) => (
                <button key={value} type="button" className={progress === value ? 'active' : ''} onClick={() => setProgress(value)}>{value === 100 ? 'Done ✓' : `${value}%`}</button>
              ))}
            </div>
          </div>
          <Field label="What did you do today?" hint="Anything blocking you? Say so here — your manager sees it.">
            <textarea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Inspected the property and sent photos to the client." />
          </Field>
          <div className="field">
            <span className="field-label">Earlier updates</span>
            {!updates ? <p className="muted-note">Loading…</p> : !updates.length ? <p className="muted-note">No updates yet — this will be the first.</p> : (
              <ul className="tu-history">
                {updates.map((item) => (
                  <li key={item.id}>
                    <ProgressBar value={item.progress} small />
                    <div><strong>{item.userName || 'Former member'}</strong> · <span className="muted">{formatDateTime(item.createdAt)}</span>{item.note && <p>{item.note}</p>}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon="send" disabled={busy}>{busy ? 'Posting…' : progress === 100 ? 'Mark as done' : 'Post update'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function TaskCard({ task, canEdit, canMove, onStatus, draggable, onUpdate }) {
  const { openForm, remove } = useWorkspace()
  const due = task.status !== 'Completed' ? dueLabel(task.dueDate) : null
  return (
    <article
      className={`task-card${task.status === 'Completed' ? ' done' : ''}`}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
    >
      <div className="task-card-top">
        <Pill tone={priorityTone[task.priority]}>{task.priority}</Pill>
        {canEdit && <Menu items={[
          { label: 'Edit task', icon: 'edit', onSelect: () => openForm('task', task) },
          { label: 'Delete task', icon: 'trash', danger: true, onSelect: () => remove('task', task) },
        ]} />}
      </div>
      {canEdit
        ? <button type="button" className="task-title" onClick={() => openForm('task', task)}>{task.title}</button>
        : <span className="task-title">{task.title}</span>}
      {task.description && <p className="task-desc">{task.description}</p>}
      <div className="task-meta">
        <span className="task-project">{task.projectName || 'No project'}</span>
        {due && <span className={`due due-${due.tone}`}><Icon name="clock" size={13} />{due.text}</span>}
      </div>
      <ProgressBar value={task.progress || 0} />
      {task.status !== 'Completed' && (
        <div className="task-update-row">
          <span className={isToday(task.lastUpdateAt) ? 'tu-fresh' : 'tu-stale'}>{task.lastUpdateAt ? `Updated ${timeAgo(task.lastUpdateAt)}` : 'No updates yet'}</span>
          {canMove && <button type="button" className="text-link" onClick={() => onUpdate(task)}>Post update</button>}
        </div>
      )}
      <div className="task-foot">
        {task.assigneeName ? <span className="assignee"><Avatar name={task.assigneeName} size="xs" />{task.assigneeName}</span> : <span className="assignee muted">Unassigned</span>}
        {canMove && (
          <select className="inline-select" aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => onStatus(task, event.target.value)}>
            {taskStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
        )}
      </div>
    </article>
  )
}

function Tasks() {
  const { account, data, isManager, openForm, remove, patch, params, navigate, search } = useWorkspace()
  const [layout, setLayout] = useState(readView)
  const [scope, setScope] = useState(isManager ? 'all' : 'mine')
  const [dropTarget, setDropTarget] = useState(null)
  const [updating, setUpdating] = useState(null)
  const projectFilter = params.project || ''
  const query = search.trim().toLowerCase()

  const tasks = data.tasks
    .filter((task) => scope === 'all' || task.assigneeId === account.user.id)
    .filter((task) => !projectFilter || task.projectId === projectFilter)
    .filter((task) => !query || `${task.title} ${task.description} ${task.projectName || ''} ${task.assigneeName || ''}`.toLowerCase().includes(query))

  function changeLayout(next) {
    setLayout(next)
    try {
      localStorage.setItem('ovo.tasks.view', next)
    } catch {
      // Remembering the layout is a convenience only.
    }
  }

  function setStatus(task, status) {
    if (task.status === status) return
    patch(`/api/tasks/${task.id}`, { status }, ['tasks', 'dashboard', 'projects'], status === 'Completed' ? 'Task completed' : `Moved to ${status}`)
  }

  const canMove = (task) => isManager || task.assigneeId === account.user.id
  const activeProject = data.projects.find((project) => project.id === projectFilter)

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Workspace / Tasks"
        title={activeProject ? activeProject.name : isManager ? 'Tasks' : 'My tasks'}
        description={activeProject ? 'Tasks in this project.' : isManager ? 'Assign work, set priorities and move tasks across the board.' : 'Everything assigned to you. Drag a card or change its status as you go.'}
      >
        <Button icon="chart" onClick={() => navigate('reports')}>{isManager ? 'Team reports' : 'Weekly report'}</Button>
        {isManager && <Button variant="primary" icon="plus" onClick={() => openForm('task', { projectId: projectFilter || undefined })}>New task</Button>}
      </PageHeader>

      <div className="toolbar-row">
        {isManager && (
          <Segmented label="Task scope" value={scope} onChange={setScope} options={[
            { value: 'all', label: 'All tasks', count: data.tasks.filter((task) => !projectFilter || task.projectId === projectFilter).length },
            { value: 'mine', label: 'Assigned to me', count: data.tasks.filter((task) => task.assigneeId === account.user.id && (!projectFilter || task.projectId === projectFilter)).length },
          ]} />
        )}
        {isManager && data.projects.length > 0 && (
          <select className="filter-select" aria-label="Filter by project" value={projectFilter} onChange={(event) => navigate('tasks', event.target.value ? { project: event.target.value } : {})}>
            <option value="">All projects</option>
            {data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        )}
        <div className="spacer" />
        <Segmented label="Layout" value={layout} onChange={changeLayout} options={[
          { value: 'board', label: 'Board', icon: 'board' },
          { value: 'list', label: 'List', icon: 'list' },
        ]} />
      </div>

      {!data.tasks.length ? (
        <Empty icon="tasks" title={isManager ? 'No tasks yet' : 'No tasks assigned to you'}
          action={isManager && <Button variant="primary" icon="plus" onClick={() => openForm('task')}>Create a task</Button>}>
          {isManager ? 'Break projects into tasks and assign them to your team.' : 'When a manager assigns you a task you’ll get a notification.'}
        </Empty>
      ) : layout === 'board' ? (
        <div className="board">
          {taskStatuses.map((status) => {
            const column = tasks.filter((task) => task.status === status)
            return (
              <section
                key={status}
                className={`board-col${dropTarget === status ? ' drop' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setDropTarget(status) }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDropTarget(null)
                  const task = data.tasks.find((item) => item.id === event.dataTransfer.getData('text/plain'))
                  if (task && canMove(task)) setStatus(task, status)
                }}
              >
                <header><span className={`status-dot status-${status.replace(/\s/g, '').toLowerCase()}`} />{status}<em>{column.length}</em></header>
                <div className="board-cards">
                  {column.map((task) => <TaskCard key={task.id} task={task} canEdit={isManager} canMove={canMove(task)} onStatus={setStatus} draggable={canMove(task)} onUpdate={setUpdating} />)}
                  {!column.length && <p className="board-empty">Drop tasks here</p>}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Task</th><th>Project</th><th>Assignee</th><th>Progress</th><th>Priority</th><th>Due</th><th>Status</th>{isManager && <th aria-label="Actions" />}</tr></thead>
            <tbody>
              {tasks.map((task) => {
                const due = task.status !== 'Completed' ? dueLabel(task.dueDate) : null
                return (
                  <tr key={task.id} className={task.status === 'Completed' ? 'row-done' : ''}>
                    <td className="cell-strong">{isManager ? <button type="button" className="link-cell" onClick={() => openForm('task', task)}>{task.title}</button> : task.title}</td>
                    <td>{task.projectName || '—'}</td>
                    <td>{task.assigneeName ? <span className="assignee"><Avatar name={task.assigneeName} size="xs" />{task.assigneeName}</span> : <span className="muted">Unassigned</span>}</td>
                    <td>
                      <ProgressBar value={task.progress || 0} small />
                      {canMove(task) && task.status !== 'Completed' && <button type="button" className="text-link tu-link" onClick={() => setUpdating(task)}>Post update</button>}
                    </td>
                    <td><Pill tone={priorityTone[task.priority]}>{task.priority}</Pill></td>
                    <td>{due ? <span className={`due due-${due.tone}`}>{due.text}</span> : '—'}</td>
                    <td>
                      {canMove(task) ? (
                        <select className="inline-select" aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => setStatus(task, event.target.value)}>
                          {taskStatuses.map((status) => <option key={status}>{status}</option>)}
                        </select>
                      ) : task.status}
                    </td>
                    {isManager && <td className="cell-actions"><Menu items={[
                      { label: 'Edit task', icon: 'edit', onSelect: () => openForm('task', task) },
                      { label: 'Delete task', icon: 'trash', danger: true, onSelect: () => remove('task', task) },
                    ]} /></td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!tasks.length && <p className="muted-note pad">No tasks match these filters.</p>}
        </div>
      )}
      {updating && <TaskUpdateModal task={updating} onClose={() => setUpdating(null)} />}
    </div>
  )
}

export default Tasks

import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Empty, Menu, PageHeader, Pill, Segmented } from '../../components/ui.jsx'
import { taskStatuses } from '../../lib/constants.js'
import { dueLabel } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

const priorityTone = { Low: 'muted', Medium: 'neutral', High: 'warning', Urgent: 'danger' }

function readView() {
  try {
    return localStorage.getItem('workora.tasks.view') || 'board'
  } catch {
    return 'board'
  }
}

function TaskCard({ task, canEdit, canMove, onStatus, draggable }) {
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
  const projectFilter = params.project || ''
  const query = search.trim().toLowerCase()

  const tasks = data.tasks
    .filter((task) => scope === 'all' || task.assigneeId === account.user.id)
    .filter((task) => !projectFilter || task.projectId === projectFilter)
    .filter((task) => !query || `${task.title} ${task.description} ${task.projectName || ''} ${task.assigneeName || ''}`.toLowerCase().includes(query))

  function changeLayout(next) {
    setLayout(next)
    try {
      localStorage.setItem('workora.tasks.view', next)
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
                  {column.map((task) => <TaskCard key={task.id} task={task} canEdit={isManager} canMove={canMove(task)} onStatus={setStatus} draggable={canMove(task)} />)}
                  {!column.length && <p className="board-empty">Drop tasks here</p>}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Task</th><th>Project</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th>{isManager && <th aria-label="Actions" />}</tr></thead>
            <tbody>
              {tasks.map((task) => {
                const due = task.status !== 'Completed' ? dueLabel(task.dueDate) : null
                return (
                  <tr key={task.id} className={task.status === 'Completed' ? 'row-done' : ''}>
                    <td className="cell-strong">{isManager ? <button type="button" className="link-cell" onClick={() => openForm('task', task)}>{task.title}</button> : task.title}</td>
                    <td>{task.projectName || '—'}</td>
                    <td>{task.assigneeName ? <span className="assignee"><Avatar name={task.assigneeName} size="xs" />{task.assigneeName}</span> : <span className="muted">Unassigned</span>}</td>
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
    </div>
  )
}

export default Tasks

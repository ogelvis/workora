import { useState } from 'react'
import { Button, Empty, Menu, PageHeader, Pill, Segmented } from '../../components/ui.jsx'
import { projectStatuses, projectTone } from '../../lib/constants.js'
import { dueLabel } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

function Projects() {
  const { data, openForm, remove, navigate, search, save, toast } = useWorkspace()
  const [filter, setFilter] = useState('open')
  const query = search.trim().toLowerCase()
  const projects = data.projects
    .filter((project) => filter === 'all'
      || (filter === 'open' ? !['Completed', 'Cancelled'].includes(project.status) : project.status === 'Completed'))
    .filter((project) => !query || `${project.name} ${project.description} ${project.clientName || ''}`.toLowerCase().includes(query))
  const openCount = data.projects.filter((project) => !['Completed', 'Cancelled'].includes(project.status)).length

  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Projects" title="Projects" description="Plan the work, link it to a client and track progress as tasks get done.">
        <Button variant="primary" icon="plus" onClick={() => openForm('project')}>New project</Button>
      </PageHeader>
      <Segmented
        label="Filter projects"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: 'Active', count: openCount },
          { value: 'done', label: 'Completed', count: data.projects.filter((project) => project.status === 'Completed').length },
          { value: 'all', label: 'All', count: data.projects.length },
        ]}
      />
      {projects.length ? (
        <div className="project-grid">
          {projects.map((project) => {
            const progress = project.taskCount ? Math.round((project.completedTaskCount / project.taskCount) * 100) : 0
            const due = project.status !== 'Completed' ? dueLabel(project.dueDate) : null
            return (
              <article key={project.id} className="project-card">
                <div className="project-top">
                  <Pill tone={projectTone[project.status]}>{project.status}</Pill>
                  <Menu items={[
                    { label: 'Edit project', icon: 'edit', onSelect: () => openForm('project', project) },
                    { label: 'View tasks', icon: 'tasks', onSelect: () => navigate('tasks', { project: project.id }) },
                    { label: 'Add task', icon: 'plus', onSelect: () => openForm('task', { projectId: project.id }) },
                    { label: 'Delete project', icon: 'trash', danger: true, onSelect: () => remove('project', project, `“${project.name}” and its ${project.taskCount} task${project.taskCount === 1 ? '' : 's'} will be permanently deleted.`) },
                  ]} />
                </div>
                <button type="button" className="project-title" onClick={() => openForm('project', project)}>
                  <h3>{project.name}</h3>
                  <p>{project.clientName || 'Internal'}{due ? ` · ${due.text.toLowerCase()}` : ''}</p>
                </button>
                {project.description && <p className="project-desc">{project.description}</p>}
                <div className="progress">
                  <div className="progress-head">
                    <span>{project.completedTaskCount} of {project.taskCount} tasks</span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                </div>
                <div className="project-foot">
                  <button type="button" className="text-link" onClick={() => navigate('tasks', { project: project.id })}>Open tasks</button>
                  <select
                    className="inline-select"
                    aria-label={`Status for ${project.name}`}
                    value={project.status}
                    onChange={(event) => save('project', {
                      name: project.name, description: project.description, dueDate: project.dueDate,
                      clientId: project.clientId, status: event.target.value,
                    }, project).catch((error) => toast(error.message, 'error'))}
                  >
                    {projectStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <Empty
          icon="projects"
          title={data.projects.length ? 'No projects match' : 'Start your first project'}
          action={!data.projects.length && <Button variant="primary" icon="plus" onClick={() => openForm('project')}>New project</Button>}
        >
          {data.projects.length ? 'Try a different filter or search.' : 'Projects group your tasks, deadlines and client work in one place.'}
        </Empty>
      )}
    </div>
  )
}

export default Projects

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import './App.css'

const statDefinitions = [
  { label: 'Active Projects', key: 'projects', tone: 'purple' },
  { label: 'Pending Tasks', key: 'tasks', tone: 'blue' },
  { label: 'Team Members', key: 'members', tone: 'green' },
  { label: 'Clients', key: 'clients', tone: 'orange' },
  { label: 'Campaigns', key: 'campaigns', tone: 'pink' },
  { label: 'Storage', key: 'storage', tone: 'slate' },
]

const quickActions = ['New Project', 'Add Client', 'Create Task']

const businessNav = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'projects', label: 'Projects' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'clients', label: 'Clients' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'files', label: 'My Files' },
  { key: 'vault', label: 'Document Vault' },
  { key: 'chat', label: 'Team Chat' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'billing', label: 'Billing' },
  { key: 'settings', label: 'Settings' },
]

function StatCard({ value, label, tone }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SectionHeader({ eyebrow, title, action, onAction }) {
  return (
    <div className="section-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action ? <button type="button" className="sm-btn" onClick={onAction}>{action}</button> : null}
    </div>
  )
}

async function api(path, options = {}) {
  let response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Workora API')) throw error
    throw new Error('Workora API is unavailable. Start the API server and check your Neon configuration.')
  }
  if (response.status === 204) return null
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('Workora API did not return a valid response. Check that the API server is running.')
  }
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.')
  return payload
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [currentView, setCurrentView] = useState('dashboard')
  const [search, setSearch] = useState('')
  const [account, setAccount] = useState(null)
  const [error, setError] = useState('')
  const [dashboard, setDashboard] = useState(null)
  const [today] = useState(() => new Date())
  const [isPending, startTransition] = useTransition()
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])

  const role = account?.role || 'staff'
  const navItems = useMemo(
    () => businessNav.filter((item) => {
      if (role === 'staff') return ['dashboard', 'tasks', 'files', 'chat', 'notifications', 'calendar'].includes(item.key)
      if (role === 'manager') return item.key !== 'billing' && item.key !== 'settings'
      return true
    }),
    [role],
  )

  const filteredClients = useMemo(
    () => clients.filter((client) => `${client.name} ${client.contactName} ${client.email}`.toLowerCase().includes(search.toLowerCase())),
    [clients, search],
  )
  const filteredProjects = useMemo(
    () => projects.filter((project) => `${project.name} ${project.description}`.toLowerCase().includes(search.toLowerCase())),
    [projects, search],
  )
  const filteredTasks = useMemo(
    () => tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(search.toLowerCase())),
    [tasks, search],
  )
  const workspaceStats = statDefinitions
    .filter((stat) => role !== 'staff' || ['tasks', 'storage'].includes(stat.key))
    .map((stat) => {
    const data = dashboard?.stats
    const value = stat.key === 'storage'
      ? `${formatBytes(data?.storageUsedBytes || 0)} / ${formatBytes(data?.storageLimitBytes || 0)}`
      : stat.key === 'campaigns' && data?.campaigns === null
        ? '—'
      : data?.[stat.key] ?? 0
    return { ...stat, value }
  })
  const recentActivity = dashboard?.activity || []

  const refreshWorkspace = useCallback(async () => {
    const [dashboardData, clientData, projectData, taskData] = await Promise.all([
      api('/api/dashboard'),
      role === 'staff' ? Promise.resolve({ clients: [] }) : api('/api/clients'),
      role === 'staff' ? Promise.resolve({ projects: [] }) : api('/api/projects'),
      api('/api/tasks'),
    ])
    startTransition(() => {
      setDashboard(dashboardData)
      setClients(clientData.clients)
      setProjects(projectData.projects)
      setTasks(taskData.tasks)
    })
  }, [role, startTransition])

  useEffect(() => {
    let active = true
    api('/api/auth/me')
      .then((data) => {
        if (active) {
          setAccount(data)
          setLoggedIn(true)
        }
      })
      .catch((requestError) => {
        if (!active) return
        if (!requestError.message.includes('sign in') && !requestError.message.includes('session has expired')) {
          setError(requestError.message)
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    refreshWorkspace().catch((requestError) => setError(requestError.message))
  }, [loggedIn, refreshWorkspace])

  async function submitAuth(event) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const body = Object.fromEntries(form.entries())
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register'
    try {
      const data = await api(endpoint, { method: 'POST', body: JSON.stringify(body) })
      setAccount(data)
      setLoggedIn(true)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function logout() {
    setError('')
    try {
      await api('/api/auth/logout', { method: 'POST' })
      setAccount(null)
      setLoggedIn(false)
      setCurrentView('dashboard')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function createRecord(resource, label, payload) {
    const name = window.prompt(`Enter ${label}:`)
    if (!name?.trim()) return
    setError('')
    try {
      await api(`/api/${resource}`, {
        method: 'POST',
        body: JSON.stringify({ [resource === 'tasks' ? 'title' : 'name']: name.trim(), ...payload }),
      })
      await refreshWorkspace()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  if (!loggedIn) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">W</div>
            <div>
              <p>Workora</p>
              <small>Business Workspace</small>
            </div>
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              className={authMode === 'login' ? 'active' : ''}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={authMode === 'register' ? 'active' : ''}
              onClick={() => setAuthMode('register')}
            >
              Register
            </button>
          </div>

          {authMode === 'login' ? (
            <form className="auth-form" onSubmit={submitAuth}>
              <h1>Welcome back</h1>
              <label>
                Work email
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              <button type="submit" className="primary-btn">
                Sign in to workspace
              </button>
              {error && <p className="form-error" role="alert">{error}</p>}
            </form>
          ) : (
            <form className="auth-form" onSubmit={submitAuth}>
              <h1>Create your business</h1>
              <div className="wizard-steps">
                <span className="step active">1</span>
                <span className="step">2</span>
                <span className="step">3</span>
                <span className="step">4</span>
              </div>
              <label>
                Business name
                <input name="organizationName" type="text" minLength="2" maxLength="160" required />
              </label>
              <label>
                Business email
                <input name="businessEmail" type="email" required />
              </label>
              <label>
                Administrator name
                <input name="fullName" type="text" minLength="2" maxLength="120" autoComplete="name" required />
              </label>
              <label>
                Administrator email
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Password (at least 12 characters)
                <input name="password" type="password" minLength="12" maxLength="128" autoComplete="new-password" required />
              </label>
              <button type="submit" className="primary-btn">
                Create workspace
              </button>
              {error && <p className="form-error" role="alert">{error}</p>}
            </form>
          )}
        </div>
      </div>
    )
  }

  function onQuickAction(action) {
    if (action === 'New Project') return createRecord('projects', 'project name')
    if (action === 'Add Client') return createRecord('clients', 'client name')
    if (action === 'Create Task') return createRecord('tasks', 'task title')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-mark">W</div>
          <div>
            <strong>Workora</strong>
            <small>Business Workspace</small>
          </div>
        </div>

        <nav className="main-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={currentView === item.key ? 'nav-item active' : 'nav-item'}
              onClick={() => setCurrentView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <span className="eyebrow">Storage</span>
          <strong>{workspaceStats.find((stat) => stat.key === 'storage')?.value}</strong>
          <div className="meter">
            <span style={{
              width: `${dashboard?.stats?.storageLimitBytes
                ? Math.min(100, (dashboard.stats.storageUsedBytes / dashboard.stats.storageLimitBytes) * 100)
                : 0}%`,
            }} />
          </div>
        </div>
      </aside>

      <main className="workspace-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">{account?.organization?.name || 'Your workspace'}</span>
            <h1>Business Workspace</h1>
          </div>

          <div className="toolbar">
            <div className="search-box">
              <span>⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients, projects, tasks..." />
            </div>

            <span className="role-badge">{role}</span>
            <button type="button" className="primary-btn small" onClick={logout}>Log out</button>
          </div>
        </header>

        <div className="content">
          {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')}>Dismiss</button></div>}
          {isPending && <div className="empty-state" role="status">Refreshing workspace data…</div>}
          {currentView === 'dashboard' && (
            <>
              <section className="welcome-panel">
                <div>
                  <span className="eyebrow">Welcome back</span>
                  <h2>Welcome back, {account?.user?.fullName}</h2>
                  <p>{today.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                {role !== 'staff' && <button type="button" className="primary-btn" onClick={() => createRecord('projects', 'project name')}>+ New project</button>}
              </section>

              <section className="stats-grid">
                {workspaceStats.map((stat) => (
                  <StatCard key={stat.label} label={stat.label} value={stat.value} tone={stat.tone} />
                ))}
              </section>

              <section className="content-grid two-col">
                <div className="panel">
                  <SectionHeader eyebrow="Recent activity" title="Company activity" />
                  <ul className="activity-list">
                    {recentActivity.map((entry) => (
                      <li key={`${entry.user}-${entry.object}-${entry.time}`}>
                        <div className="avatar">{entry.user.slice(0, 1).toUpperCase()}</div>
                        <div>
                          <p><strong>{entry.user}</strong> {entry.action} <strong>{entry.object}</strong></p>
                          <small>{new Date(entry.time).toLocaleString()}</small>
                        </div>
                      </li>
                    ))}
                    {!recentActivity.length && <li className="empty-state">Workspace activity will appear here as your team works.</li>}
                  </ul>
                </div>

                <div className="panel">
                  <SectionHeader eyebrow="Quick actions" title="Start working" />
                  {role === 'staff'
                    ? <p className="empty-state">Ask a workspace manager to create projects, clients, or tasks.</p>
                    : <div className="action-grid">
                      {quickActions.map((item) => (
                        <button key={item} type="button" className="action-btn" onClick={() => onQuickAction(item)}>{item}</button>
                      ))}
                    </div>}
                </div>
              </section>

              <section className="content-grid two-col">
                <div className="panel">
                  <SectionHeader eyebrow="Recent files" title="Shared files" action="Browse files" onAction={() => setCurrentView('files')} />
                  <div className="data-list">
                    <div className="empty-state">File storage has not been connected yet.</div>
                  </div>
                </div>

                <div className="panel">
                  <SectionHeader eyebrow="Schedule" title="Upcoming tasks" />
                  <ul className="deadline-list">
                    {tasks.filter((task) => task.dueDate).slice(0, 4).map((task) => (
                      <li key={task.id}><span>{task.title}</span><strong>{new Date(`${task.dueDate}T00:00:00`).toLocaleDateString()}</strong></li>
                    ))}
                    {!tasks.some((task) => task.dueDate) && <li className="empty-state">Tasks with due dates will show up here.</li>}
                  </ul>
                </div>
              </section>
            </>
          )}

          {currentView === 'projects' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Project workspace" title="Project portfolio" action="Create project" onAction={() => createRecord('projects', 'project name')} />
              <div className="project-grid">
                {filteredProjects.map((project) => (
                  <article key={project.id} className="project-card">
                    <div className="project-topline">
                      <span className="pill muted">{project.status}</span>
                      <span className="pill">{project.dueDate ? new Date(`${project.dueDate}T00:00:00`).toLocaleDateString() : 'No deadline'}</span>
                    </div>
                    <h3>{project.name}</h3>
                    <p>{project.description || 'No project description yet.'}</p>
                  </article>
                ))}
                {!filteredProjects.length && <div className="empty-state">{projects.length ? 'No projects match your search.' : 'No projects yet. Create your first project to get started.'}</div>}
              </div>
            </div>
          )}

          {currentView === 'tasks' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Workflow" title="My tasks" action="New task" onAction={() => createRecord('tasks', 'task title')} />
              <div className="task-grid">
                {filteredTasks.map((task) => (
                  <article key={task.id} className="task-card">
                    <div className="task-head">
                      <h3>{task.title}</h3>
                      <span className={`priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
                    </div>
                    <p>{task.assigneeName ? `Assigned to ${task.assigneeName}. ` : 'Unassigned. '}{task.description || 'No task description yet.'}</p>
                    <div className="task-meta">
                      <span>{task.status}</span>
                      <span>{task.dueDate ? `Due ${new Date(`${task.dueDate}T00:00:00`).toLocaleDateString()}` : 'No due date'}</span>
                    </div>
                  </article>
                ))}
                {!filteredTasks.length && <div className="empty-state">{tasks.length ? 'No tasks match your search.' : 'No tasks assigned to this view yet.'}</div>}
              </div>
            </div>
          )}

          {currentView === 'clients' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="CRM" title="Client management" action="Add client" onAction={() => createRecord('clients', 'client name')} />
              <div className="table-card">
                <div className="table-header">
                  <span>Client</span>
                  <span>Contact</span>
                  <span>Status</span>
                  <span>Industry</span>
                </div>
                {filteredClients.map((client) => (
                  <div key={client.id} className="table-row">
                    <strong>{client.name}</strong>
                    <span>{client.contactName || client.email || '—'}</span>
                    <span className="status-pill">{client.status}</span>
                    <span>{client.industry}</span>
                  </div>
                ))}
                {!filteredClients.length && <div className="empty-state">{clients.length ? 'No clients match your search.' : 'No clients yet. Add your first client to start building your CRM.'}</div>}
              </div>
            </div>
          )}

          {currentView === 'campaigns' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Marketing" title="Campaigns" />
              <div className="empty-state">Campaign tracking will be available after its database and API module is connected.</div>
            </div>
          )}

          {currentView === 'files' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Files" title="Company file manager" />
              <div className="file-panel">
                <div className="folder-grid">
                  {['Company Documents', 'Marketing', 'Clients', 'Projects', 'Finance', 'HR', 'Images', 'Videos', 'Shared Files'].map((folder) => (
                    <div key={folder} className="folder-card">📁 {folder}</div>
                  ))}
                </div>

                <div className="file-grid">
                  <div className="empty-state">File uploads require a configured object-storage provider. No files are being presented as uploaded.</div>
                </div>
              </div>
            </div>
          )}

          {currentView === 'vault' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Protected records" title="Document vault" />
              <div className="empty-state">Vault document storage has not been configured yet.</div>
            </div>
          )}

          {currentView === 'chat' && (
            <div className="chat-layout">
              <aside className="panel sidebar-panel">
                <SectionHeader eyebrow="Channels" title="Team chat" />
                <ul className="channel-list">
                  <li className="empty-state">No chat channels are connected yet.</li>
                </ul>
              </aside>

              <div className="panel full-panel chat-panel">
                <div className="chat-header">
                  <h3>Team chat</h3>
                </div>
                <div className="messages">
                  <div className="empty-state">Messaging is not connected to the database yet.</div>
                </div>
              </div>
            </div>
          )}

          {currentView === 'notifications' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Alerts" title="Notifications" />
              <div className="empty-state">You are all caught up. Notifications will appear here when connected.</div>
            </div>
          )}

          {currentView === 'billing' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Subscription" title="Billing overview" />
              <div className="empty-state">Billing provider integration has not been configured. No payment or subscription actions are available yet.</div>
            </div>
          )}

          {currentView === 'settings' && (
            <div className="panel full-panel">
              <SectionHeader eyebrow="Workspace management" title="Company settings" />
              <div className="settings-grid">
                <div className="settings-card">
                  <h3>Company profile</h3>
                  <p>Business name, logo, address, website and contact information.</p>
                </div>
                <div className="settings-card">
                  <h3>Team settings</h3>
                  <p>Members, departments, roles and permissions.</p>
                </div>
                <div className="settings-card">
                  <h3>Security</h3>
                  <p>Password controls, sessions, 2FA architecture and security logs.</p>
                </div>
                <div className="settings-card">
                  <h3>Storage & billing</h3>
                  <p>Usage limits, payment history and invoices.</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

export default App

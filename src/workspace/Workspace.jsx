import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, BrandMark, Confirm, IconButton, useToast } from '../components/ui.jsx'
import { RecordForm } from '../components/RecordForms.jsx'
import { recordTypes } from '../lib/constants.js'
import { api } from '../lib/api.js'
import { capitalize, slug } from '../lib/format.js'
import { ADMIN_ROLES, MANAGER_ROLES, WorkspaceContext, allowedViews, canSee, navigation, readHash } from './context.js'
import Overview from './views/Overview.jsx'
import Projects from './views/Projects.jsx'
import Tasks from './views/Tasks.jsx'
import Clients from './views/Clients.jsx'
import Campaigns from './views/Campaigns.jsx'
import Calendar from './views/Calendar.jsx'
import Files from './views/Files.jsx'
import Chat from './views/Chat.jsx'
import Notifications from './views/Notifications.jsx'
import Billing from './views/Billing.jsx'
import Settings from './views/Settings.jsx'
import Admin from './views/Admin.jsx'
import './workspace.css'

const views = {
  overview: Overview, projects: Projects, tasks: Tasks, clients: Clients, campaigns: Campaigns,
  calendar: Calendar, files: Files, vault: Files, chat: Chat, notifications: Notifications,
  billing: Billing, settings: Settings, admin: Admin,
}

// Which store collections each record type touches, so a save refreshes only what changed.
const dependents = {
  client: ['clients', 'projects', 'campaigns', 'dashboard'],
  project: ['projects', 'tasks', 'dashboard'],
  task: ['tasks', 'projects', 'dashboard', 'notifications'],
  campaign: ['campaigns', 'dashboard'],
  event: ['events', 'dashboard'],
}

const loaders = {
  dashboard: { path: '/api/dashboard', pick: (data) => data },
  clients: { path: '/api/clients', pick: (data) => data.clients, roles: MANAGER_ROLES },
  projects: { path: '/api/projects', pick: (data) => data.projects, roles: MANAGER_ROLES },
  tasks: { path: '/api/tasks', pick: (data) => data.tasks },
  campaigns: { path: '/api/campaigns', pick: (data) => data.campaigns, roles: MANAGER_ROLES },
  events: { path: '/api/calendar', pick: (data) => data.events },
  notifications: { path: '/api/notifications', pick: (data) => data.notifications },
  members: { path: '/api/members', pick: (data) => data.members },
}

function Workspace({ account, setAccount, onSignedOut }) {
  const role = account.role
  const toast = useToast()
  const [route, setRoute] = useState(readHash)
  const [data, setData] = useState({ clients: [], projects: [], tasks: [], campaigns: [], events: [], notifications: [], members: [] })
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [search, setSearch] = useState('')
  const [navOpen, setNavOpen] = useState(false)

  const platformAdmin = Boolean(account.platformAdmin)
  const allowed = useMemo(() => allowedViews(role, platformAdmin), [role, platformAdmin])
  const view = allowed.some((item) => item.key === route.view) ? route.view : 'overview'

  useEffect(() => {
    const onHash = () => {
      setRoute(readHash())
      setNavOpen(false)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((nextView, params = {}) => {
    const query = new URLSearchParams(params).toString()
    window.location.hash = `/${nextView}${query ? `?${query}` : ''}`
  }, [])

  const reload = useCallback(async (keys = Object.keys(loaders)) => {
    const wanted = keys.filter((key) => !loaders[key].roles || loaders[key].roles.includes(role))
    const results = await Promise.allSettled(wanted.map((key) => api(loaders[key].path)))
    const next = {}
    let failure
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[wanted[index]] = loaders[wanted[index]].pick(result.value)
      else failure = result.reason
    })
    setData((current) => ({ ...current, ...next }))
    if (failure?.status === 401) onSignedOut()
    else if (failure) toast(failure.message, 'error')
  }, [role, toast, onSignedOut])

  // Refresh on every screen change so work done by teammates shows up without a page reload.
  useEffect(() => {
    reload().finally(() => setLoaded(true))
  }, [reload, view])

  useEffect(() => {
    setSearch('')
  }, [view])

  // Keep the notification badge fresh without a full reload.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload(['notifications'])
    }, 30_000)
    return () => clearInterval(timer)
  }, [reload])

  const openForm = useCallback((type, record) => setForm({ type, record }), [])

  const save = useCallback(async (type, values, record) => {
    const { endpoint, noun } = recordTypes[type]
    const result = record?.id
      ? await api(`/api/${endpoint}/${record.id}`, { method: 'PUT', body: values })
      : await api(`/api/${endpoint}`, { method: 'POST', body: values })
    await reload(dependents[type])
    toast(record?.id ? `${capitalize(noun)} updated` : `${capitalize(noun)} created`)
    return result
  }, [reload, toast])

  const remove = useCallback((type, record, message) => {
    const { endpoint } = recordTypes[type]
    setConfirm({
      title: `Delete ${type}?`,
      message: message || `“${record.name || record.title}” will be permanently deleted.`,
      onConfirm: async () => {
        await api(`/api/${endpoint}/${record.id}`, { method: 'DELETE' })
        await reload(dependents[type])
        toast(`${capitalize(type)} deleted`)
      },
    })
  }, [reload, toast])

  const patch = useCallback(async (path, body, keys, message) => {
    try {
      const result = await api(path, { method: 'PATCH', body })
      await reload(keys)
      if (message) toast(message)
      return result
    } catch (requestError) {
      toast(requestError.message, 'error')
      return null
    }
  }, [reload, toast])

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } finally {
      onSignedOut()
    }
  }

  const unread = data.notifications.filter((item) => !item.readAt).length
  const counts = {
    projects: data.projects.filter((project) => !['Completed', 'Cancelled'].includes(project.status)).length,
    tasks: data.tasks.filter((task) => task.status !== 'Completed' && (MANAGER_ROLES.includes(role) ? task.assigneeId === account.user.id : true)).length,
    notifications: unread,
  }

  const context = {
    account, setAccount, role, data, loaded, reload, navigate, params: route.params, search, setSearch,
    openForm, save, remove, patch, toast, confirm: setConfirm,
    isManager: MANAGER_ROLES.includes(role), isAdmin: ADMIN_ROLES.includes(role),
  }
  const View = views[view]
  const current = allowed.find((item) => item.key === view)
  const lookups = { clients: data.clients, projects: data.projects, members: data.members }

  return (
    <WorkspaceContext.Provider value={context}>
      <div className={`ws${navOpen ? ' nav-open' : ''}`}>
        <aside className="ws-sidebar" aria-label="Workspace navigation">
          <div className="ws-brand">
            <BrandMark size={32} />
            <div><strong>workora</strong><small>{account.organization.name}</small></div>
            <IconButton icon="close" label="Close menu" className="ws-nav-close" onClick={() => setNavOpen(false)} />
          </div>
          <nav className="ws-nav">
            {navigation.map((group) => {
              const items = group.items.filter((item) => canSee(item, role, platformAdmin))
              if (!items.length) return null
              return (
                <div key={group.section} className="ws-nav-group">
                  <span className="ws-nav-label">{group.section}</span>
                  {items.map((item) => (
                    <a key={item.key} href={`#/${item.key}`} className={view === item.key ? 'active' : ''} aria-current={view === item.key ? 'page' : undefined}>
                      <Icon name={item.icon} size={17} />
                      <span>{item.label}</span>
                      {counts[item.key] > 0 && <em className={item.key === 'notifications' ? 'dot-count' : ''}>{counts[item.key]}</em>}
                    </a>
                  ))}
                </div>
              )
            })}
          </nav>
          <div className="ws-user">
            <Avatar name={account.user.fullName} />
            <div>
              <strong>{account.user.fullName}</strong>
              <small>{capitalize(role)}</small>
            </div>
            <IconButton icon="logout" label="Log out" onClick={logout} />
          </div>
        </aside>
        <button type="button" className="ws-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />

        <div className="ws-main">
          <header className="ws-topbar">
            <IconButton icon="menu" label="Open menu" className="ws-menu-btn" onClick={() => setNavOpen(true)} />
            <div className="ws-crumbs">
              <span className="ws-crumb-dot" aria-hidden="true">✳</span>
              <span>{slug(account.organization.name)}</span>
              <Icon name="right" size={13} />
              <strong>{current?.label}</strong>
            </div>
            {['projects', 'tasks', 'clients', 'campaigns', 'files', 'vault'].includes(view) && (
              <label className="ws-search">
                <Icon name="search" size={16} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${current?.label.toLowerCase()}…`} aria-label={`Search ${current?.label}`} />
              </label>
            )}
            <div className="ws-top-actions">
              <a href="#/notifications" className="icon-btn ws-bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Icon name="bell" size={17} />
                {unread > 0 && <span className="badge-dot" />}
              </a>
              <a href="#/settings" className="ws-avatar-link" aria-label="Account settings"><Avatar name={account.user.fullName} size="sm" /></a>
            </div>
          </header>
          {account.subscription?.trialExpired && ADMIN_ROLES.includes(role) && (
            <div className="ws-banner">
              <Icon name="alert" size={16} />
              Your free trial has ended. Your workspace keeps working while billing is being set up.
              <a href="#/billing">View plan</a>
            </div>
          )}
          <main className="ws-content" key={view}>
            <View vault={view === 'vault'} />
          </main>
        </div>
      </div>
      {form && (
        <RecordForm
          type={form.type}
          record={form.record}
          lookups={lookups}
          onClose={() => setForm(null)}
          onSubmit={(values) => save(form.type, values, form.record)}
        />
      )}
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
    </WorkspaceContext.Provider>
  )
}

export default Workspace

import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Avatar, BrandMark, Confirm, IconButton, useToast } from '../components/ui.jsx'
import { RecordForm } from '../components/RecordForms.jsx'
import { recordTypes } from '../lib/constants.js'
import { api } from '../lib/api.js'
import { capitalize } from '../lib/format.js'
import { ADMIN_ROLES, AREAS, MANAGER_ROLES, WorkspaceContext, allowedViews, buildNavigation, readHash } from './context.js'
import { industryFor, itemName } from '../../shared/industries.js'
import { AccountMenu, CreateMenu, SearchPalette } from './Command.jsx'
import Sheets, { NewSheetModal } from './views/Sheets.jsx'
import Sheet from './views/Sheet.jsx'
import Forms from './views/Forms.jsx'
import Automations from './views/Automations.jsx'
import Updates, { UPDATE_CATEGORIES } from './views/Updates.jsx'
import { PayModal } from './Pay.jsx'
import { InviteModal } from './Invite.jsx'
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
import './workspace.css'
import './ovo.css'

const views = {
  overview: Overview, projects: Projects, tasks: Tasks, clients: Clients, campaigns: Campaigns,
  calendar: Calendar, files: Files, vault: Files, chat: Chat, notifications: Notifications,
  billing: Billing, settings: Settings, sheets: Sheets, sheet: Sheet, forms: Forms, automations: Automations, updates: Updates,
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
  dms: { path: '/api/dms', pick: (data) => data.conversations },
  sheets: { path: '/api/sheets', pick: (data) => data.sheets },
}

function Workspace({ account, setAccount, onSignedOut }) {
  const role = account.role
  const toast = useToast()
  const [route, setRoute] = useState(readHash)
  const [data, setData] = useState({ clients: [], projects: [], tasks: [], campaigns: [], events: [], notifications: [], members: [], dms: [], sheets: [] })
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [search, setSearch] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [newSheet, setNewSheet] = useState(null)
  const [latestUpdate, setLatestUpdate] = useState(null)
  const [paying, setPaying] = useState(false)
  const [inviting, setInviting] = useState(false)
  const industry = industryFor(account.organization.industry)

  const allowed = useMemo(() => allowedViews(role), [role])
  const view = allowed.some((item) => item.key === route.view) ? route.view : 'overview'

  // The newest OVO announcement from the last two weeks shows as a banner until dismissed.
  useEffect(() => {
    let dismissed = []
    try { dismissed = JSON.parse(localStorage.getItem('ovo.dismissedUpdates') || '[]') } catch { /* private mode */ }
    api('/api/announcements').then((result) => {
      const latest = result.announcements[0]
      if (latest && Date.now() - new Date(latest.sentAt).getTime() < 14 * 86400000 && !dismissed.includes(latest.id)) setLatestUpdate(latest)
    }).catch(() => {})
  }, [])

  function dismissUpdate() {
    try {
      const dismissed = JSON.parse(localStorage.getItem('ovo.dismissedUpdates') || '[]')
      localStorage.setItem('ovo.dismissedUpdates', JSON.stringify([latestUpdate.id, ...dismissed].slice(0, 50)))
    } catch { /* private mode */ }
    setLatestUpdate(null)
  }

  // Ctrl/⌘ + K opens universal search from anywhere.
  useEffect(() => {
    function onKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearching(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

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
    if (failure?.status === 401) onSignedOut('expired')
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
      if (document.visibilityState === 'visible') reload(['notifications', 'dms'])
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
    chat: data.dms.reduce((sum, conversation) => sum + conversation.unread, 0),
  }

  const context = {
    account, setAccount, role, data, loaded, reload, navigate, params: route.params, search, setSearch, openPayment: () => setPaying(true), openInvite: () => setInviting(true),
    openForm, save, remove, patch, toast, confirm: setConfirm,
    isManager: MANAGER_ROLES.includes(role), isAdmin: ADMIN_ROLES.includes(role),
  }
  const View = views[view]
  const groups = buildNavigation(role, industry, data.sheets)
  const currentSheet = view === 'sheet' ? data.sheets.find((sheet) => sheet.id === route.params.id) : null
  const currentLabel = currentSheet?.name || groups.flatMap((group) => group.items).find((item) => item.key === view)?.label || AREAS[view]?.label
  const isActive = (item) => (item.view === 'sheet' ? view === 'sheet' && route.params.id === item.params.id : view === item.key)
  const hrefFor = (item) => (item.view ? `#/${item.view}?${new URLSearchParams(item.params)}` : `#/${item.key}`)
  const visibleCore = new Set(groups[0].items.map((item) => item.key))
  const manager = MANAGER_ROLES.includes(role)

  const createItems = [
    { label: 'Work', items: [
      visibleCore.has('clients') && { label: industry.clientLabel ? industry.clientLabel.replace(/s$/, '') : 'Client', icon: 'clients', tone: 'pink', onSelect: () => openForm('client') },
      visibleCore.has('projects') && { label: 'Project', icon: 'projects', tone: 'blue', onSelect: () => openForm('project') },
      { label: 'Task', icon: 'tasks', tone: 'green', onSelect: () => openForm('task') },
      visibleCore.has('campaigns') && { label: 'Campaign', icon: 'campaigns', tone: 'orange', onSelect: () => openForm('campaign') },
      { label: 'Event', icon: 'calendar', tone: 'amber', onSelect: () => openForm('event') },
    ].filter(Boolean).filter(() => manager) },
    { label: 'Records', items: [
      ...data.sheets.filter((sheet) => sheet.pinned).slice(0, 6).map((sheet) => ({ label: itemName(sheet), icon: sheet.icon, tone: sheet.color, onSelect: () => navigate('sheet', { id: sheet.id, add: Date.now() }) })),
      { label: 'New sheet', icon: 'sheet', tone: 'teal', onSelect: () => setNewSheet('') },
      { label: 'Form', icon: 'form', tone: 'blue', onSelect: () => navigate('forms') },
      manager && { label: 'Automation', icon: 'bolt', tone: 'amber', onSelect: () => navigate('automations') },
    ].filter(Boolean) },
    { label: 'Share', items: [
      ADMIN_ROLES.includes(role) && { label: 'Invite people', icon: 'team', tone: 'pink', onSelect: () => setInviting(true) },
      { label: 'Upload file', icon: 'upload', tone: 'sky', onSelect: () => navigate('files') },
      { label: 'Message', icon: 'chat', tone: 'violet', onSelect: () => navigate('chat') },
    ].filter(Boolean) },
  ].filter((group) => group.items.length)
  const lookups = { clients: data.clients, projects: data.projects, members: data.members }

  return (
    <WorkspaceContext.Provider value={context}>
      <div className={`ws${navOpen ? ' nav-open' : ''}`}>
        <aside className="ws-sidebar" aria-label="Workspace navigation">
          <div className="ws-brand">
            <BrandMark size={24} label="OVO" />
            <IconButton icon="close" label="Close menu" className="ws-nav-close" onClick={() => setNavOpen(false)} />
          </div>
          <a href="#/settings" className="ws-org">
            <span className="ws-org-mark">{account.organization.name.slice(0, 1).toUpperCase()}</span>
            <span><strong>{account.organization.name}</strong><small>{industry.key === 'other' && !account.organization.industry ? 'Business workspace' : industry.label}</small></span>
          </a>
          <nav className="ws-nav">
            {groups.map((group) => (
              <div key={group.section || 'main'} className="ws-nav-group">
                {group.section && (
                  <span className="ws-nav-label">
                    {group.section}
                    {group.module && <button type="button" className="ws-nav-add" aria-label="Add a module" title="Add a module" onClick={() => setNewSheet('')}><Icon name="plus" size={13} /></button>}
                  </span>
                )}
                {group.items.map((item) => (
                  <a key={item.key} href={hrefFor(item)} className={isActive(item) ? 'active' : ''} aria-current={isActive(item) ? 'page' : undefined}>
                    <span className={`nav-icon tone-${item.tone}`}><Icon name={item.icon} size={15} /></span>
                    <span>{item.label}</span>
                    {counts[item.key] > 0 && <em className={['notifications', 'chat'].includes(item.key) ? 'dot-count' : ''}>{counts[item.key]}</em>}
                  </a>
                ))}
                {group.module && !group.items.length && (
                  <button type="button" className="ws-nav-empty" onClick={() => setNewSheet('')}><Icon name="plus" size={14} />Add a module</button>
                )}
              </div>
            ))}
          </nav>
          {ADMIN_ROLES.includes(role) && (
            <button type="button" className="ws-invite" onClick={() => { setNavOpen(false); setInviting(true) }}>
              <Icon name="plus" size={16} />Invite people
            </button>
          )}
          <div className="ws-user">
            <Avatar name={account.user.fullName} />
            <div>
              <strong>{account.user.fullName}</strong>
              <small>{capitalize(role)}</small>
            </div>
            <button type="button" className="ws-logout" onClick={logout}><Icon name="logout" size={15} />Log out</button>
          </div>
        </aside>
        <button type="button" className="ws-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />

        <div className="ws-main">
          <header className="ws-topbar">
            <IconButton icon="menu" label="Open menu" className="ws-menu-btn" onClick={() => setNavOpen(true)} />
            <div className="ws-crumbs">
              <span>{account.organization.name}</span>
              <Icon name="right" size={13} />
              <strong>{currentLabel}</strong>
            </div>
            <button type="button" className="ws-omni" onClick={() => setSearching(true)}>
              <Icon name="search" size={16} />
              <span>Search everything…</span>
              <kbd>Ctrl K</kbd>
            </button>
            {['projects', 'tasks', 'clients', 'campaigns', 'files', 'vault', 'sheets'].includes(view) && (
              <label className="ws-search">
                <Icon name="filter" size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Filter ${currentLabel?.toLowerCase()}…`} aria-label={`Filter ${currentLabel}`} />
              </label>
            )}
            <div className="ws-top-actions">
              <CreateMenu items={createItems} />
              <a href="#/notifications" className="icon-btn ws-bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Icon name="bell" size={17} />
                {unread > 0 && <span className="badge-dot" />}
              </a>
              <AccountMenu account={account} role={role} onInvite={() => setInviting(true)} onLogout={logout} />
            </div>
          </header>
          {account.passwordSet === false && view !== 'settings' && (
            <div className="ws-banner ws-banner-brand">
              <Icon name="key" size={16} />
              Welcome to OVO! Choose a password so you can sign in again from any device.
              <a href="#/settings?tab=security">Set password</a>
            </div>
          )}
          {ADMIN_ROLES.includes(role) && view !== 'billing' && (() => {
            const subscription = account.subscription
            if (!subscription) return null
            const daysLeft = subscription.status === 'active' && subscription.currentPeriodEnd ? Math.ceil((new Date(subscription.currentPeriodEnd) - Date.now()) / 86_400_000) : null
            const lapsed = subscription.trialExpired || ['past_due', 'expired', 'cancelled'].includes(subscription.status) || (daysLeft !== null && daysLeft < 0)
            if (!lapsed && (daysLeft === null || daysLeft > 7)) return null
            return (
              <div className="ws-banner">
                <Icon name="alert" size={16} />
                <span>{lapsed
                  ? (subscription.status === 'trial' ? 'Your free trial has ended. Pay for a plan to keep growing your workspace.' : 'Your plan has lapsed. Renew to keep everything running smoothly.')
                  : `Your ${subscription.plan} plan ${daysLeft === 0 ? 'ends today' : `ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}.`}</span>
                <button type="button" className="ws-banner-action" onClick={() => setPaying(true)}>{lapsed ? 'Pay now' : 'Renew now'}</button>
              </div>
            )
          })()}
          {latestUpdate && view !== 'updates' && (
            <div className={`ws-banner ws-banner-update tone-${UPDATE_CATEGORIES[latestUpdate.category]?.tone || 'violet'}`}>
              <Icon name={UPDATE_CATEGORIES[latestUpdate.category]?.icon || 'sparkle'} size={16} />
              <span><b>{UPDATE_CATEGORIES[latestUpdate.category]?.label || 'Update'}:</b> {latestUpdate.title}</span>
              <a href={`#/updates?id=${latestUpdate.id}`} onClick={dismissUpdate}>Read more</a>
              <button type="button" className="ws-banner-close" aria-label="Dismiss" onClick={dismissUpdate}><Icon name="close" size={14} /></button>
            </div>
          )}
          <main className={`ws-content${view === 'sheet' ? ' ws-content-wide' : ''}`} key={view === 'sheet' ? `sheet-${route.params.id}` : view}>
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
      {searching && <SearchPalette onClose={() => setSearching(false)} />}
      {paying && <PayModal onClose={() => setPaying(false)} />}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {newSheet !== null && <NewSheetModal initialTemplate={newSheet} onClose={() => setNewSheet(null)} />}
    </WorkspaceContext.Provider>
  )
}

export default Workspace

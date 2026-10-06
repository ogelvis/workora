import { createContext, useContext } from 'react'

export const WorkspaceContext = createContext(null)

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

export const MANAGER_ROLES = ['owner', 'admin', 'manager']
export const ADMIN_ROLES = ['owner', 'admin']

// Every built-in area, with the colour it wears across OVO.
export const AREAS = {
  overview: { label: 'Home', icon: 'home', tone: 'violet' },
  clients: { label: 'Clients', icon: 'clients', tone: 'pink', roles: MANAGER_ROLES },
  projects: { label: 'Projects', icon: 'projects', tone: 'blue', roles: MANAGER_ROLES },
  tasks: { label: 'Tasks', icon: 'tasks', tone: 'green' },
  reports: { label: 'Reports', icon: 'chart', tone: 'teal' },
  campaigns: { label: 'Campaigns', icon: 'campaigns', tone: 'orange', roles: MANAGER_ROLES },
  calendar: { label: 'Calendar', icon: 'calendar', tone: 'amber' },
  sheets: { label: 'Sheets', icon: 'sheet', tone: 'teal' },
  sheet: { label: 'Sheet', icon: 'sheet', tone: 'teal', hidden: true },
  forms: { label: 'Forms', icon: 'form', tone: 'blue' },
  automations: { label: 'Automations', icon: 'bolt', tone: 'amber' },
  files: { label: 'Files', icon: 'files', tone: 'sky' },
  vault: { label: 'Document Vault', icon: 'vault', tone: 'indigo', roles: ADMIN_ROLES },
  chat: { label: 'Messages', icon: 'chat', tone: 'violet' },
  notifications: { label: 'Notifications', icon: 'bell', tone: 'rose' },
  updates: { label: 'What’s new', icon: 'sparkle', tone: 'violet', hidden: true },
  billing: { label: 'Billing', icon: 'billing', tone: 'slate', roles: ADMIN_ROLES },
  settings: { label: 'Settings', icon: 'settings', tone: 'slate' },
}

export function canSee(item, role) {
  return !item.roles || item.roles.includes(role)
}

// The sidebar adapts to the business: its industry decides which areas lead, and its
// pinned sheets become modules of their own.
export function buildNavigation(role, industry, sheets = []) {
  const area = (key) => ({ key, ...AREAS[key], ...(key === 'clients' && industry.clientLabel ? { label: industry.clientLabel } : {}) })
  const visible = (items) => items.filter((item) => canSee(item, role))
  const modules = sheets.filter((sheet) => sheet.pinned).map((sheet) => ({
    key: `sheet:${sheet.id}`, view: 'sheet', params: { id: sheet.id }, label: sheet.name, icon: sheet.icon, tone: sheet.color, count: sheet.rowCount,
  }))
  return [
    { section: '', items: visible([area('overview'), ...industry.core.map(area), area('reports'), area('sheets'), area('forms'), area('automations')]) },
    { section: industry.key === 'other' ? 'Modules' : industry.label, items: modules, module: true },
    { section: 'Collaborate', items: visible([area('chat'), area('files'), area('vault'), area('notifications')]) },
    { section: 'Company', items: visible([area('billing'), area('settings')]) },
  ].filter((group) => group.items.length || group.module)
}

export function allowedViews(role) {
  return Object.entries(AREAS).filter(([, item]) => canSee(item, role)).map(([key, item]) => ({ key, ...item }))
}

export function readHash() {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { view: path || 'overview', params: Object.fromEntries(new URLSearchParams(query)) }
}

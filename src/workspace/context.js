import { createContext, useContext } from 'react'

export const WorkspaceContext = createContext(null)

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

export const MANAGER_ROLES = ['owner', 'admin', 'manager']
export const ADMIN_ROLES = ['owner', 'admin']

export const navigation = [
  { section: 'Workspace', items: [
    { key: 'overview', label: 'Overview', icon: 'overview' },
    { key: 'projects', label: 'Projects', icon: 'projects', roles: MANAGER_ROLES },
    { key: 'tasks', label: 'Tasks', icon: 'tasks' },
    { key: 'clients', label: 'Clients', icon: 'clients', roles: MANAGER_ROLES },
    { key: 'campaigns', label: 'Campaigns', icon: 'campaigns', roles: MANAGER_ROLES },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  ] },
  { section: 'Collaborate', items: [
    { key: 'files', label: 'Files', icon: 'files' },
    { key: 'vault', label: 'Document Vault', icon: 'vault', roles: ADMIN_ROLES },
    { key: 'chat', label: 'Team chat', icon: 'chat' },
    { key: 'notifications', label: 'Notifications', icon: 'bell' },
  ] },
  { section: 'Platform', items: [
    { key: 'admin', label: 'Super admin', icon: 'shield', platformOnly: true },
  ] },
  { section: 'Company', items: [
    { key: 'billing', label: 'Billing', icon: 'billing', roles: ADMIN_ROLES },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ] },
]

export function canSee(item, role, platformAdmin) {
  if (item.platformOnly) return platformAdmin
  return !item.roles || item.roles.includes(role)
}

export function allowedViews(role, platformAdmin) {
  return navigation.flatMap((group) => group.items).filter((item) => canSee(item, role, platformAdmin))
}

export function readHash() {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { view: path || 'overview', params: Object.fromEntries(new URLSearchParams(query)) }
}

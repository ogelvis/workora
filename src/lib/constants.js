export const clientStatuses = ['Lead', 'Contacted', 'Interested', 'Active', 'Completed', 'Archived']
export const projectStatuses = ['Planning', 'In Progress', 'Review', 'Completed', 'On Hold', 'Cancelled']
export const taskStatuses = ['To Do', 'In Progress', 'Review', 'Completed']
export const priorities = ['Low', 'Medium', 'High', 'Urgent']
export const campaignStatuses = ['Planning', 'Active', 'Review', 'Completed', 'Paused']
export const eventTypes = ['Meeting', 'Task deadline', 'Project deadline', 'Campaign', 'Client appointment', 'Company event']

export const projectTone = {
  Planning: 'neutral', 'In Progress': 'info', Review: 'warning', Completed: 'success', 'On Hold': 'muted', Cancelled: 'muted',
}

export const recordTypes = {
  client: { noun: 'client', endpoint: 'clients' },
  project: { noun: 'project', endpoint: 'projects' },
  task: { noun: 'task', endpoint: 'tasks' },
  campaign: { noun: 'campaign', endpoint: 'campaigns' },
  event: { noun: 'event', endpoint: 'calendar' },
}

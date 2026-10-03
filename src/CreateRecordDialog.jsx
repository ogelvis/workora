function CreateRecordDialog({ type, onClose, onCreate, clients, projects, busy }) {
  if (!type) return null
  const labels = {
    clients: ['Add a client', 'Save client'],
    projects: ['Create a project', 'Create project'],
    tasks: ['Create a task', 'Create task'],
    campaigns: ['Create a campaign', 'Create campaign'],
    calendar: ['Schedule an event', 'Schedule event'],
  }

  function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    if (type === 'campaigns') {
      values.platforms = values.platforms ? values.platforms.split(',').map((item) => item.trim()).filter(Boolean) : []
      values.budget = values.budget ? Number(values.budget) : 0
      if (!values.campaignType) delete values.campaignType
      if (!values.clientId) delete values.clientId
    }
    if (type === 'calendar') {
      values.startsAt = new Date(values.startsAt).toISOString()
      values.endsAt = values.endsAt ? new Date(values.endsAt).toISOString() : null
      if (!values.clientId) delete values.clientId
      if (!values.projectId) delete values.projectId
    }
    if (type === 'tasks' && !values.projectId) delete values.projectId
    if (['tasks', 'projects'].includes(type) && !values.dueDate) delete values.dueDate
    onCreate(type, values)
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title">
        <div className="dialog-heading">
          <div><span className="eyebrow">Workspace</span><h2 id="record-dialog-title">{labels[type][0]}</h2></div>
          <button type="button" className="dialog-close" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
        </div>
        <form className="record-form" onSubmit={submit}>
          <label>
            {type === 'tasks' ? 'Task title' : type === 'calendar' ? 'Event title' : type === 'campaigns' ? 'Campaign name' : type === 'projects' ? 'Project name' : 'Client name'}
            <input name={type === 'tasks' ? 'title' : type === 'calendar' ? 'title' : 'name'} required maxLength={160} autoFocus />
          </label>
          {type === 'clients' && <>
            <label>Contact person<input name="contactName" maxLength={120} /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Industry<input name="industry" maxLength={120} /></label>
          </>}
          {['projects', 'tasks', 'campaigns', 'calendar'].includes(type) && (
            <label>{type === 'campaigns' ? 'Objective' : 'Description'}<textarea name={type === 'campaigns' ? 'objective' : 'description'} maxLength={3000} rows={3} /></label>
          )}
          {type === 'tasks' && <label>Project<select name="projectId" defaultValue=""><option value="">No project linked</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          {['projects', 'tasks'].includes(type) && <label>Due date<input name="dueDate" type="date" /></label>}
          {type === 'tasks' && <label>Priority<select name="priority" defaultValue="Medium"><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label>}
          {type === 'campaigns' && <>
            <label>Campaign type<input name="campaignType" maxLength={80} placeholder="Social media, email, events…" /></label>
            <label>Client<select name="clientId" defaultValue=""><option value="">No client linked</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <div className="dialog-two-fields"><label>Start date<input name="startDate" type="date" /></label><label>End date<input name="endDate" type="date" /></label></div>
            <label>Budget<input name="budget" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Platforms<input name="platforms" placeholder="Instagram, Email, Google" /></label>
          </>}
          {type === 'calendar' && <>
            <label>Event type<select name="eventType"><option>Meeting</option><option>Task deadline</option><option>Project deadline</option><option>Campaign</option><option>Client appointment</option><option>Company event</option></select></label>
            <div className="dialog-two-fields"><label>Starts<input name="startsAt" type="datetime-local" required /></label><label>Ends<input name="endsAt" type="datetime-local" /></label></div>
            <label>Project<select name="projectId" defaultValue=""><option value="">No project linked</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label>Client<select name="clientId" defaultValue=""><option value="">No client linked</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          </>}
          <div className="dialog-actions">
            <button type="button" className="sm-btn" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-btn small" disabled={busy}>{busy ? 'Saving…' : labels[type][1]}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default CreateRecordDialog

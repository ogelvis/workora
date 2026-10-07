import { useState } from 'react'
import { Avatar, Button, Empty, Menu, PageHeader, Segmented } from '../../components/ui.jsx'
import { clientStatuses } from '../../lib/constants.js'
import { timeAgo } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

function Clients() {
  const { data, openForm, remove, save, toast, search, navigate } = useWorkspace()
  const [filter, setFilter] = useState('all')
  const query = search.trim().toLowerCase()
  const clients = data.clients
    .filter((client) => filter === 'all' || (filter === 'pipeline' ? ['Lead', 'Contacted', 'Interested'].includes(client.status) : client.status === filter))
    .filter((client) => !query || `${client.name} ${client.contactName} ${client.email} ${client.industry}`.toLowerCase().includes(query))

  function setStatus(client, status) {
    save('client', { name: client.name, contactName: client.contactName, email: client.email, industry: client.industry, status }, client)
      .catch((error) => toast(error.message, 'error'))
  }

  const pipeline = data.clients.filter((client) => ['Lead', 'Contacted', 'Interested'].includes(client.status)).length

  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Clients" title="Clients" description="Every client relationship, from first contact to finished work.">
        <Button variant="primary" icon="plus" onClick={() => openForm('client')}>Add client</Button>
      </PageHeader>
      <Segmented label="Filter clients" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: data.clients.length },
        { value: 'pipeline', label: 'Pipeline', count: pipeline },
        { value: 'Active', label: 'Active', count: data.clients.filter((client) => client.status === 'Active').length },
        { value: 'Completed', label: 'Completed', count: data.clients.filter((client) => client.status === 'Completed').length },
      ]} />
      {clients.length ? (
        <div className="card table-card">
          <table className="table">
            <thead><tr><th>Client</th><th>Contact</th><th>Industry</th><th>Projects</th><th>Status</th><th>Added</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <button type="button" className="client-cell" onClick={() => openForm('client', client)}>
                      <Avatar name={client.name} size="sm" photo={false} />
                      <strong>{client.name}</strong>
                    </button>
                  </td>
                  <td>
                    <div className="two-line">
                      <span>{client.contactName || '—'}</span>
                      {client.email && <a href={`mailto:${client.email}`}>{client.email}</a>}
                    </div>
                  </td>
                  <td>{client.industry || <span className="muted">—</span>}</td>
                  <td>{client.projectCount || <span className="muted">0</span>}</td>
                  <td>
                    <select className="inline-select" aria-label={`Status for ${client.name}`} value={client.status} onChange={(event) => setStatus(client, event.target.value)}>
                      {clientStatuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </td>
                  <td className="muted">{timeAgo(client.createdAt)}</td>
                  <td className="cell-actions">
                    <Menu items={[
                      { label: 'Edit client', icon: 'edit', onSelect: () => openForm('client', client) },
                      { label: 'New project', icon: 'projects', onSelect: () => openForm('project', { clientId: client.id }) },
                      { label: 'New campaign', icon: 'campaigns', onSelect: () => openForm('campaign', { clientId: client.id }) },
                      client.projectCount > 0 && { label: 'View projects', icon: 'right', onSelect: () => navigate('projects') },
                      { label: 'Delete client', icon: 'trash', danger: true, onSelect: () => remove('client', client, `“${client.name}” will be deleted. Linked projects and campaigns are kept but unlinked.`) },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="clients" title={data.clients.length ? 'No clients match' : 'Add your first client'}
          action={!data.clients.length && <Button variant="primary" icon="plus" onClick={() => openForm('client')}>Add client</Button>}>
          {data.clients.length ? 'Try another filter or search.' : 'Keep contacts, status and linked work for every client in one place.'}
        </Empty>
      )}
    </div>
  )
}

export default Clients

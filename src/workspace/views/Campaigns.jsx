import { useState } from 'react'
import { Button, Empty, Menu, PageHeader, Segmented } from '../../components/ui.jsx'
import { campaignStatuses } from '../../lib/constants.js'
import { formatDay, formatMoney } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

function Campaigns() {
  const { data, openForm, remove, patch, search } = useWorkspace()
  const [filter, setFilter] = useState('all')
  const query = search.trim().toLowerCase()
  const campaigns = data.campaigns
    .filter((campaign) => filter === 'all' || campaign.status === filter)
    .filter((campaign) => !query || `${campaign.name} ${campaign.objective} ${campaign.clientName || ''} ${campaign.campaignType}`.toLowerCase().includes(query))
  const totals = data.campaigns.reduce((sum, campaign) => ({
    budget: sum.budget + campaign.budget,
    leads: sum.leads + campaign.leadsGenerated,
    conversions: sum.conversions + campaign.conversions,
    revenue: sum.revenue + campaign.revenue,
  }), { budget: 0, leads: 0, conversions: 0, revenue: 0 })

  return (
    <div className="stack">
      <PageHeader eyebrow="Workspace / Campaigns" title="Campaigns" description="Plan marketing work and record what each campaign delivered.">
        <Button variant="primary" icon="plus" onClick={() => openForm('campaign')}>New campaign</Button>
      </PageHeader>
      {data.campaigns.length > 0 && (
        <section className="stat-grid compact">
          <div className="stat-tile"><span className="stat-label">Total budget</span><strong className="stat-value">{formatMoney(totals.budget)}</strong></div>
          <div className="stat-tile"><span className="stat-label">Leads generated</span><strong className="stat-value">{formatMoney(totals.leads)}</strong></div>
          <div className="stat-tile"><span className="stat-label">Conversions</span><strong className="stat-value">{formatMoney(totals.conversions)}</strong><span className="stat-note">{totals.leads ? `${Math.round((totals.conversions / totals.leads) * 100)}% of leads` : 'No leads yet'}</span></div>
          <div className="stat-tile"><span className="stat-label">Revenue</span><strong className="stat-value">{formatMoney(totals.revenue)}</strong></div>
        </section>
      )}
      <Segmented label="Filter campaigns" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: data.campaigns.length },
        ...campaignStatuses.map((status) => ({ value: status, label: status, count: data.campaigns.filter((campaign) => campaign.status === status).length })),
      ]} />
      {campaigns.length ? (
        <div className="campaign-grid">
          {campaigns.map((campaign) => (
            <article key={campaign.id} className="campaign-card">
              <div className="project-top">
                <span className="eyebrow">{campaign.campaignType || 'Campaign'}</span>
                <Menu items={[
                  { label: 'Edit campaign', icon: 'edit', onSelect: () => openForm('campaign', campaign) },
                  { label: 'Delete campaign', icon: 'trash', danger: true, onSelect: () => remove('campaign', campaign) },
                ]} />
              </div>
              <button type="button" className="project-title" onClick={() => openForm('campaign', campaign)}>
                <h3>{campaign.name}</h3>
                <p>{campaign.clientName || 'No client linked'}{campaign.startDate ? ` · ${formatDay(campaign.startDate)}${campaign.endDate ? ` – ${formatDay(campaign.endDate)}` : ''}` : ''}</p>
              </button>
              {campaign.objective && <p className="project-desc">{campaign.objective}</p>}
              {campaign.platforms?.length > 0 && <div className="chips">{campaign.platforms.map((platform) => <span key={platform} className="chip">{platform}</span>)}</div>}
              <dl className="campaign-stats">
                <div><dt>Budget</dt><dd>{formatMoney(campaign.budget)}</dd></div>
                <div><dt>Leads</dt><dd>{formatMoney(campaign.leadsGenerated)}</dd></div>
                <div><dt>Revenue</dt><dd>{formatMoney(campaign.revenue)}</dd></div>
              </dl>
              <div className="project-foot">
                <span className={`status-dot status-${campaign.status.toLowerCase()}`} />
                <select className="inline-select" aria-label={`Status for ${campaign.name}`} value={campaign.status}
                  onChange={(event) => patch(`/api/campaigns/${campaign.id}/status`, { status: event.target.value }, ['campaigns', 'dashboard'], `Moved to ${event.target.value}`)}>
                  {campaignStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty icon="campaigns" title={data.campaigns.length ? 'No campaigns match' : 'Plan your first campaign'}
          action={!data.campaigns.length && <Button variant="primary" icon="plus" onClick={() => openForm('campaign')}>New campaign</Button>}>
          {data.campaigns.length ? 'Try another filter or search.' : 'Track budgets, platforms, leads and revenue for every campaign.'}
        </Empty>
      )}
    </div>
  )
}

export default Campaigns

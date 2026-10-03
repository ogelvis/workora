import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Meter, PageHeader, Pill } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { capitalize, formatBytes } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

const planCopy = {
  Starter: { label: 'A place to start', blurb: 'For small teams bringing their work together.' },
  Business: { label: 'For teams in motion', blurb: 'More room and capabilities for growing teams.' },
  Enterprise: { label: 'Built around you', blurb: 'Room for larger teams and advanced needs.' },
}

function Usage({ label, value, max, format = (number) => number }) {
  // Projects use null for no limit; Enterprise stores the member limit as the int4 maximum.
  const unlimited = max === null || max === undefined || max >= 2147483647
  return (
    <div className="usage">
      <div className="usage-head"><span>{label}</span><strong>{format(value)} <em>/ {unlimited ? 'Unlimited' : format(max)}</em></strong></div>
      <Meter value={value} max={unlimited ? value * 10 || 1 : max} />
    </div>
  )
}

function Billing() {
  const { toast } = useWorkspace()
  const [billing, setBilling] = useState(null)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    api('/api/billing').then(setBilling).catch((error) => toast(error.message, 'error'))
  }, [toast])

  if (!billing) return <div className="stack"><PageHeader eyebrow="Company / Billing" title="Billing" /><div className="card chart-skeleton" /></div>

  const { subscription, usage, plans } = billing
  const trialDays = subscription.status === 'trial' && subscription.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt) - now) / 86_400_000))
    : null

  return (
    <div className="stack">
      <PageHeader eyebrow="Company / Billing" title="Plan & usage" description="Your subscription, what it includes and how much of it you’re using." />

      <section className="grid-1-1">
        <div className="card plan-current">
          <span className="eyebrow">Current plan</span>
          <div className="plan-name">
            <h2>{subscription.plan}</h2>
            <Pill tone={subscription.trialExpired ? 'danger' : subscription.status === 'trial' ? 'info' : 'success'}>
              {subscription.trialExpired ? 'Trial ended' : subscription.status === 'trial' ? 'Free trial' : capitalize(subscription.status)}
            </Pill>
          </div>
          <p>
            {subscription.trialExpired
              ? `Your trial ended on ${new Date(subscription.trialEndsAt).toLocaleDateString()}. Nothing has been locked.`
              : trialDays !== null
                ? `${trialDays} ${trialDays === 1 ? 'day' : 'days'} left · trial ends ${new Date(subscription.trialEndsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`
                : 'Your subscription is active.'}
          </p>
          <div className="notice">
            <Icon name="alert" size={16} />
            <span>Online payments aren’t connected yet, so plans can’t be changed here. No card has been charged.</span>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Usage</h2><p>Limits are enforced for members, projects and storage.</p></div></div>
          <div className="usage-list">
            <Usage label="Members (incl. pending invites)" value={usage.members + usage.pendingInvites} max={subscription.userLimit} />
            <Usage label="Projects" value={usage.projects} max={subscription.projectLimit} />
            <Usage label="Storage" value={usage.storageBytes} max={subscription.storageLimitBytes} format={formatBytes} />
          </div>
        </div>
      </section>

      <section>
        <div className="section-title"><span className="eyebrow">Plans</span><h2>Room to grow</h2></div>
        <div className="plans">
          {plans.map((plan) => {
            const current = plan.name === subscription.plan
            const copy = planCopy[plan.name] || {}
            return (
              <article key={plan.name} className={`plan${plan.name === 'Business' ? ' featured' : ''}${current ? ' current' : ''}`}>
                <span className="plan-label">{copy.label}</span>
                <h3>{plan.name}</h3>
                <p>{copy.blurb}</p>
                <ul>
                  <li><Icon name="check" size={14} />{plan.userLimit >= 2147483647 ? 'Unlimited members' : `Up to ${plan.userLimit} members`}</li>
                  <li><Icon name="check" size={14} />{formatBytes(plan.storageLimitBytes)} storage</li>
                  <li><Icon name="check" size={14} />{plan.projectLimit ? `${plan.projectLimit} projects` : 'Unlimited projects'}</li>
                </ul>
                <button type="button" disabled>{current ? 'Your current plan' : 'Available once payments are connected'}</button>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default Billing

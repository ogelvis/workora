import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Meter, PageHeader, Pill } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { capitalize, formatBytes, formatPrice } from '../../lib/format.js'
import { useWorkspace } from '../context.js'

const planCopy = {
  Starter: { label: 'A place to start', blurb: 'For small teams bringing their work together.' },
  Business: { label: 'For teams in motion', blurb: 'More room and capabilities for growing teams.' },
  Enterprise: { label: 'Built around you', blurb: 'Room for larger teams and advanced needs.' },
}

function Usage({ label, value, max, format = (number) => number }) {
  // Projects use null for no limit; unlimited members are stored as the int4 maximum.
  const unlimited = max === null || max === undefined || (format !== formatBytes && max >= 2147483647)
  return (
    <div className="usage">
      <div className="usage-head"><span>{label}</span><strong>{format(value)} <em>/ {unlimited ? 'Unlimited' : format(max)}</em></strong></div>
      <Meter value={value} max={unlimited ? value * 10 || 1 : max} />
    </div>
  )
}

function upgradeLink(email, plan, account) {
  const subject = `Upgrade ${account.organization.name} to ${plan.name}`
  const body = `Hello Workora,\n\nWe would like to move ${account.organization.name} to the ${plan.name} plan. Please send payment details.\n\n${account.user.fullName}\n${account.user.email}`
  return `mailto:${email}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`
}

function Billing() {
  const { toast, account } = useWorkspace()
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
                : subscription.currentPeriodEnd
                  ? `Paid until ${new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`
                  : 'Your subscription is active.'}
          </p>
          <div className="notice">
            <Icon name="alert" size={16} />
            <span>
              Plans are paid by bank transfer for now. {billing.supportEmail
                ? <>Choose a plan below and we’ll reply from <strong>{billing.supportEmail}</strong> with payment details.</>
                : 'Contact Workora to upgrade.'} No card is charged in the app.
            </span>
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
                <p className="plan-price">{plan.monthlyPrice !== null ? <>{formatPrice(plan.monthlyPrice, plan.currency)} <span>/ month</span></> : 'Custom pricing'}</p>
                {plan.yearlyPrice !== null && <p className="plan-yearly">or {formatPrice(plan.yearlyPrice, plan.currency)} per year</p>}
                <ul>
                  <li><Icon name="check" size={14} />{plan.userLimit >= 2147483647 ? 'Unlimited members' : `Up to ${plan.userLimit} members`}</li>
                  <li><Icon name="check" size={14} />{formatBytes(plan.storageLimitBytes)} storage</li>
                  <li><Icon name="check" size={14} />{plan.projectLimit ? `${plan.projectLimit} projects` : 'Unlimited projects'}</li>
                </ul>
                {current || !billing.supportEmail
                  ? <button type="button" disabled>{current ? 'Your current plan' : 'Contact Workora to switch'}</button>
                  : <a className="plan-cta" href={upgradeLink(billing.supportEmail, plan, account)}>{plan.monthlyPrice === null ? 'Talk to us' : `Request ${plan.name}`}</a>}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default Billing

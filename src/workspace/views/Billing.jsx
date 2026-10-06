import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Meter, PageHeader, Pill, Segmented } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { capitalize, formatBytes, formatDateTime, formatPrice } from '../../lib/format.js'
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
  const body = `Hello OVO,\n\nWe would like to move ${account.organization.name} to the ${plan.name} plan. Please send payment details.\n\n${account.user.fullName}\n${account.user.email}`
  return `mailto:${email}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`
}

const PAYMENT_MESSAGES = {
  success: { tone: 'success', text: 'Payment received. Your plan is active — thank you!' },
  pending: { tone: 'info', text: 'Your payment is still being confirmed by Paystack. This page will update once it’s done; you can also check again below.' },
  failed: { tone: 'danger', text: 'The payment didn’t go through and you weren’t charged. You can try again.' },
}

function PaymentHistory({ payments }) {
  if (!payments?.length) return null
  return (
    <section className="card">
      <div className="card-head"><div><h2>Payment history</h2><p>Payments made online through Paystack.</p></div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Paid until</th><th>Reference</th></tr></thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td className="muted">{formatDateTime(payment.paidAt || payment.createdAt)}</td>
                <td className="cell-strong">{payment.plan} · {payment.interval === 'yearly' ? 'Yearly' : 'Monthly'}</td>
                <td>{formatPrice(payment.amount, payment.currency)}</td>
                <td><Pill tone={payment.status === 'success' ? 'success' : payment.status === 'failed' ? 'danger' : 'info'}>{payment.status === 'success' ? 'Paid' : payment.status === 'failed' ? 'Failed' : 'Pending'}</Pill></td>
                <td className="muted">{payment.periodEnd ? new Date(payment.periodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                <td className="muted mono">{payment.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Billing() {
  const { toast, account, params, setAccount } = useWorkspace()
  const [billing, setBilling] = useState(null)
  const [payments, setPayments] = useState(null)
  const [interval, setInterval] = useState('monthly')
  const [paying, setPaying] = useState('')
  const [now] = useState(() => Date.now())
  const result = PAYMENT_MESSAGES[params.payment]

  const load = useCallback(() => {
    api('/api/billing').then(setBilling).catch((error) => toast(error.message, 'error'))
    api('/api/billing/payments').then((data) => setPayments(data.payments)).catch(() => setPayments([]))
  }, [toast])
  useEffect(() => { load() }, [load])

  // Coming back from Paystack: refresh the plan everywhere in the app (trial banners and so on).
  useEffect(() => {
    if (params.payment === 'success') api('/api/auth/me').then(setAccount).catch(() => {})
  }, [params.payment, setAccount])

  async function pay(plan) {
    setPaying(plan.name)
    try {
      const { authorizationUrl } = await api('/api/billing/checkout', { method: 'POST', body: { plan: plan.name, interval } })
      window.location.assign(authorizationUrl)
    } catch (error) {
      toast(error.message, 'error')
      setPaying('')
    }
  }

  async function checkPending() {
    const pending = (payments || []).filter((payment) => payment.status === 'pending')
    try {
      const results = await Promise.all(pending.map((payment) => api(`/api/billing/payments/${payment.reference}/verify`, { method: 'POST' })))
      toast(results.some((item) => item.status === 'success') ? 'Payment confirmed — your plan is active' : 'Still waiting for Paystack to confirm')
      load()
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  if (!billing) return <div className="stack"><PageHeader eyebrow="Company / Billing" title="Billing" /><div className="card chart-skeleton" /></div>

  const { subscription, usage, plans } = billing
  const trialDays = subscription.status === 'trial' && subscription.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt) - now) / 86_400_000))
    : null

  return (
    <div className="stack">
      <PageHeader eyebrow="Company / Billing" title="Plan & usage" description="Your subscription, what it includes and how much of it you’re using." />
      {result && (
        <div className={`pay-result pay-${result.tone}`} role="status">
          <Icon name={params.payment === 'success' ? 'check' : params.payment === 'failed' ? 'alert' : 'clock'} size={18} />
          <span>{result.text}</span>
          {params.payment === 'pending' && payments?.some((payment) => payment.status === 'pending') && <button type="button" className="text-link" onClick={checkPending}>Check again</button>}
        </div>
      )}

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
          {billing.paymentsEnabled ? (
            <div className="notice notice-secure">
              <Icon name="shield" size={16} />
              <span>Pay securely by card, bank transfer or USSD through <strong>Paystack</strong>. Your plan activates as soon as the payment is confirmed.</span>
            </div>
          ) : (
            <div className="notice">
              <Icon name="alert" size={16} />
              <span>
                Plans are paid by bank transfer for now. {billing.supportEmail
                  ? <>Choose a plan below and we’ll reply from <strong>{billing.supportEmail}</strong> with payment details.</>
                  : 'Contact OVO to upgrade.'} No card is charged in the app.
              </span>
            </div>
          )}
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
        <div className="section-title plans-head">
          <div><span className="eyebrow">Plans</span><h2>Room to grow</h2></div>
          {billing.paymentsEnabled && <Segmented label="Billing period" value={interval} onChange={setInterval} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />}
        </div>
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
                {billing.paymentsEnabled && (interval === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice) ? (
                  <button type="button" className="plan-pay" disabled={Boolean(paying)} onClick={() => pay(plan)}>
                    {paying === plan.name ? 'Opening Paystack…'
                      : current && subscription.status === 'active' ? `Renew · ${formatPrice(interval === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice, plan.currency)}`
                        : `${current ? 'Pay for' : subscription.status !== 'active' || (plan.monthlyPrice || 0) > (plans.find((item) => item.name === subscription.plan)?.monthlyPrice || 0) ? 'Upgrade to' : 'Switch to'} ${plan.name} · ${formatPrice(interval === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice, plan.currency)}`}
                  </button>
                ) : current || !billing.supportEmail
                  ? <button type="button" disabled>{current ? 'Your current plan' : 'Contact OVO to switch'}</button>
                  : <a className="plan-cta" href={upgradeLink(billing.supportEmail, plan, account)}>{plan.monthlyPrice === null ? 'Talk to us' : `Request ${plan.name}`}</a>}
              </article>
            )
          })}
        </div>
      </section>
      <PaymentHistory payments={payments} />
    </div>
  )
}

export default Billing

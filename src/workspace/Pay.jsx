import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Modal, Segmented } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { formatBytes, formatPrice } from '../lib/format.js'
import { planPeople, planTotal } from '../lib/plans.js'
import { useWorkspace } from './context.js'

function PeopleStepper({ value, min, max, onChange }) {
  return (
    <div className="seat-stepper">
      <button type="button" className="btn btn-icon" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Fewer people">−</button>
      <input type="number" min={min} max={max} value={value} aria-label="Number of people"
        onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} />
      <button type="button" className="btn btn-icon" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More people">+</button>
    </div>
  )
}

// Quick checkout from anywhere in the workspace: pick a plan, period and team size, then pay on Paystack.
export function PayModal({ onClose, plan: initialPlan, interval: initialInterval = 'monthly' }) {
  const { toast, navigate } = useWorkspace()
  const [billing, setBilling] = useState(null)
  const [interval, setInterval] = useState(initialInterval)
  const [chosen, setChosen] = useState('')
  const [people, setPeople] = useState(1)
  const [busy, setBusy] = useState(false)
  const close = useRef(onClose)

  useEffect(() => {
    api('/api/billing').then((result) => {
      setBilling(result)
      const current = result.plans.find((plan) => plan.name === result.subscription.plan && plan.monthlyPrice)
      const firstPaid = result.plans.find((plan) => plan.monthlyPrice)
      const asked = result.plans.find((plan) => plan.name === initialPlan && plan.monthlyPrice)
      setChosen((asked || current || firstPaid)?.name || '')
      setPeople(Math.max(result.usage.members + result.usage.pendingInvites, result.subscription.status === 'active' ? result.subscription.seats || 0 : 0, 1))
    }).catch((error) => { toast(error.message, 'error'); close.current() })
  }, [toast, initialPlan])

  const plan = billing?.plans.find((item) => item.name === chosen)
  const inUse = billing ? billing.usage.members + billing.usage.pendingInvites : 1
  // A plan's base price always covers its included people.
  const seats = plan ? (plan.extraUserPrice ? Math.min(plan.userLimit, Math.max(people, plan.includedUsers)) : plan.includedUsers) : people
  const price = plan ? planTotal(plan, interval, seats) : null
  const tooSmall = plan && seats < inUse
  const saving = plan?.monthlyPrice && plan?.yearlyPrice ? Math.round((1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100) : 0

  async function pay() {
    setBusy(true)
    try {
      const { authorizationUrl } = await api('/api/billing/checkout', { method: 'POST', body: { plan: chosen, interval, seats } })
      window.location.assign(authorizationUrl)
    } catch (error) {
      toast(error.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Modal title="Pay for your plan" eyebrow="Billing" onClose={onClose} width={620} busy={busy}>
      <div className="modal-body stack-sm">
        {!billing ? <div className="chart-skeleton" /> : !billing.paymentsEnabled ? (
          <div className="notice">
            <Icon name="alert" size={16} />
            <span>Online payment isn’t switched on yet. {billing.supportEmail ? <>Contact <strong>{billing.supportEmail}</strong> to pay by bank transfer.</> : 'Contact OVO to upgrade.'}</span>
          </div>
        ) : <>
          <div className="pay-period">
            <Segmented label="Billing period" value={interval} onChange={setInterval} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: saving > 0 ? `Yearly · save ${saving}%` : 'Yearly' }]} />
          </div>
          <div className="pay-plans" role="radiogroup" aria-label="Plan">
            {billing.plans.filter((item) => item.monthlyPrice).map((item) => {
              const amount = interval === 'yearly' ? item.yearlyPrice : item.monthlyPrice
              return (
                <button key={item.name} type="button" role="radio" aria-checked={chosen === item.name} className={chosen === item.name ? 'active' : ''} disabled={!amount} onClick={() => setChosen(item.name)}>
                  <span className="pay-plan-top"><strong>{item.name}</strong>{item.name === billing.subscription.plan && <small>Current</small>}</span>
                  <span className="pay-plan-price">{amount ? formatPrice(amount, item.currency) : '—'}<em>/{interval === 'yearly' ? 'year' : 'month'}</em></span>
                  <span className="pay-plan-meta">{planPeople(item)} · {formatBytes(item.storageLimitBytes)}</span>
                </button>
              )
            })}
          </div>
          {plan?.extraUserPrice ? (
            <div className="pay-seats">
              <div>
                <strong>How many people?</strong>
                <small>{plan.includedUsers} included in the price · {formatPrice(plan.extraUserPrice * (interval === 'yearly' ? 10 : 1), plan.currency)} per extra person/{interval === 'yearly' ? 'year' : 'month'}. You have {inUse} now.</small>
              </div>
              <PeopleStepper value={seats} min={Math.max(1, inUse)} max={plan.userLimit} onChange={setPeople} />
            </div>
          ) : null}
          {tooSmall && <p className="invite-error">The {plan.name} plan is for up to {plan.includedUsers} people and you have {inUse}. Choose a bigger plan or remove people first.</p>}
          <div className="pay-summary">
            <span>Total today{plan?.extraUserPrice && seats > plan.includedUsers ? ` · ${seats} people` : ''}</span>
            <strong>{price ? formatPrice(price, plan.currency) : '—'}</strong>
          </div>
          <p className="pay-secure"><Icon name="shield" size={14} />Secured by Paystack — card, bank transfer or USSD. Your plan activates as soon as payment is confirmed.</p>
        </>}
      </div>
      <div className="modal-foot">
        <Button onClick={() => { onClose(); navigate('billing') }} disabled={busy}>See all billing</Button>
        {billing?.paymentsEnabled && <Button variant="primary" icon="shield" onClick={pay} disabled={!price || busy || tooSmall}>{busy ? 'Opening Paystack…' : `Pay ${price ? formatPrice(price, plan.currency) : ''}`}</Button>}
      </div>
    </Modal>
  )
}

// Room for more people on a paid plan, charged for the rest of the current period only.
export function AddPeopleModal({ billing, onClose }) {
  const { toast } = useWorkspace()
  const { subscription } = billing
  const [seats, setSeats] = useState(subscription.userLimit + 1)
  const [quote, setQuote] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      api(`/api/billing/seats/quote?seats=${seats}`).then((result) => { if (live) setQuote(result) }).catch((error) => { if (live) setQuote({ error: error.message }) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [seats])

  async function pay() {
    setBusy(true)
    try {
      const { authorizationUrl } = await api('/api/billing/seats', { method: 'POST', body: { seats } })
      window.location.assign(authorizationUrl)
    } catch (error) {
      toast(error.message, 'error')
      setBusy(false)
    }
  }

  const ready = quote && !quote.error && quote.seats === seats
  return (
    <Modal title="Add people to your plan" eyebrow="Billing" onClose={onClose} width={520} busy={busy}>
      <div className="modal-body stack-sm">
        <div className="pay-seats">
          <div>
            <strong>Room for how many people?</strong>
            <small>You have room for {subscription.userLimit} now. Each extra person is {formatPrice(subscription.extraUserPrice, subscription.currency)}/month.</small>
          </div>
          <PeopleStepper value={seats} min={subscription.userLimit + 1} max={subscription.maxUsers} onChange={setSeats} />
        </div>
        {quote?.error && <p className="invite-error">{quote.error}</p>}
        <div className="pay-summary">
          <span>{ready ? `${quote.added} more ${quote.added === 1 ? 'person' : 'people'} · ${quote.daysLeft} ${quote.daysLeft === 1 ? 'day' : 'days'} left in this period` : 'Working out the price…'}</span>
          <strong>{ready ? formatPrice(quote.amount, quote.currency) : '—'}</strong>
        </div>
        <p className="pay-secure"><Icon name="shield" size={14} />You only pay for the days left until {new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. After that, they’re part of your renewal.</p>
      </div>
      <div className="modal-foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="shield" onClick={pay} disabled={!ready || busy}>{busy ? 'Opening Paystack…' : ready ? `Pay ${formatPrice(quote.amount, quote.currency)}` : 'Pay'}</Button>
      </div>
    </Modal>
  )
}

// The workspace plan at a glance, with a pay button, for owners and admins on the home page.
export function PlanCard({ onPay }) {
  const { account } = useWorkspace()
  const [now] = useState(() => Date.now())
  const subscription = account.subscription
  if (!subscription) return null
  const end = subscription.status === 'trial' ? subscription.trialEndsAt : subscription.currentPeriodEnd
  const daysLeft = end ? Math.ceil((new Date(end) - now) / 86_400_000) : null
  if (subscription.isFree) {
    return (
      <section className="plan-strip" aria-label="Your plan">
        <span className="plan-strip-icon"><Icon name="billing" size={18} /></span>
        <div><strong>Free plan</strong><small>Upgrade for more people, storage, forms and team reports.</small></div>
        <Button variant="primary" icon="shield" onClick={onPay}>Upgrade</Button>
      </section>
    )
  }
  const lapsed = subscription.trialExpired || ['past_due', 'expired', 'cancelled'].includes(subscription.status) || (subscription.status === 'active' && daysLeft !== null && daysLeft < 0)
  const dueSoon = !lapsed && daysLeft !== null && daysLeft <= 7
  const status = lapsed
    ? (subscription.status === 'trial' ? 'Your free trial has ended' : 'Your plan has lapsed')
    : subscription.status === 'trial'
      ? `Free trial · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
      : end ? `Paid until ${new Date(end).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Active'
  return (
    <section className={`plan-strip${lapsed ? ' lapsed' : dueSoon ? ' due' : ''}`} aria-label="Your plan">
      <span className="plan-strip-icon"><Icon name="billing" size={18} /></span>
      <div>
        <strong>{subscription.plan} plan</strong>
        <small>{status}</small>
      </div>
      <Button variant={lapsed || dueSoon || subscription.status === 'trial' ? 'primary' : 'secondary'} icon="shield" onClick={onPay}>
        {subscription.status === 'trial' || lapsed ? 'Pay now' : 'Renew'}
      </Button>
    </section>
  )
}

// First steps for a new workspace, shown to owners and admins until done or dismissed.
export function GettingStarted() {
  const { account, data, openInvite, openPayment, navigate } = useWorkspace()
  const key = `ovo.gettingStarted.${account.user.id}`
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === 'done' } catch { return false } })
  const [pendingInvites, setPendingInvites] = useState(0)
  useEffect(() => {
    const load = () => api('/api/invitations').then((result) => setPendingInvites(result.invitations.length)).catch(() => {})
    load()
    window.addEventListener('ovo:invited', load)
    return () => window.removeEventListener('ovo:invited', load)
  }, [])
  const steps = [
    { label: 'Invite your team', hint: 'Add the people you work with.', done: data.members.length > 1 || pendingInvites > 0, action: 'Invite people', run: openInvite, icon: 'team' },
    { label: 'Add your first record', hint: 'A client, property, student or anything you track.', done: data.sheets.some((sheet) => sheet.rowCount > 0) || data.clients.length > 0, action: 'Open sheets', run: () => navigate('sheets'), icon: 'sheet' },
    { label: 'Set your password', hint: 'So you can sign in from any device.', done: account.passwordSet !== false, action: 'Set password', run: () => navigate('settings', { tab: 'security' }), icon: 'key' },
    { label: 'Choose a plan', hint: 'Keep growing after your free trial.', done: account.subscription?.status === 'active' && !account.subscription.isFree, action: 'See plans', run: openPayment, icon: 'billing' },
  ]
  const done = steps.filter((step) => step.done).length
  if (hidden || done === steps.length) return null
  function dismiss() {
    try { localStorage.setItem(key, 'done') } catch { /* private mode */ }
    setHidden(true)
  }
  return (
    <section className="card getting-started" aria-label="Get started">
      <div className="card-head">
        <div><h2>Get started with OVO</h2><p>{done} of {steps.length} done — a few quick steps to set up {account.organization.name}.</p></div>
        <button type="button" className="text-link" onClick={dismiss}>Hide</button>
      </div>
      <div className="gs-progress"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="gs-steps">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? 'done' : ''}>
            <span className="gs-check"><Icon name={step.done ? 'check' : step.icon} size={15} /></span>
            <div><strong>{step.label}</strong><small>{step.hint}</small></div>
            {!step.done && <Button size="sm" onClick={step.run}>{step.action}</Button>}
          </li>
        ))}
      </ol>
    </section>
  )
}

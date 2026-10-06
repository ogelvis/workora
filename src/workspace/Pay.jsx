import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Modal, Segmented } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { formatBytes, formatPrice } from '../lib/format.js'
import { useWorkspace } from './context.js'

// Quick checkout from anywhere in the workspace: pick a plan and period, then pay on Paystack.
export function PayModal({ onClose }) {
  const { toast, navigate } = useWorkspace()
  const [billing, setBilling] = useState(null)
  const [interval, setInterval] = useState('monthly')
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const close = useRef(onClose)

  useEffect(() => {
    api('/api/billing').then((result) => {
      setBilling(result)
      const current = result.plans.find((plan) => plan.name === result.subscription.plan && plan.monthlyPrice)
      const firstPaid = result.plans.find((plan) => plan.monthlyPrice)
      setChosen((current || firstPaid)?.name || '')
    }).catch((error) => { toast(error.message, 'error'); close.current() })
  }, [toast])

  const plan = billing?.plans.find((item) => item.name === chosen)
  const price = plan ? (interval === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice) : null
  const saving = plan?.monthlyPrice && plan?.yearlyPrice ? Math.round((1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100) : 0

  async function pay() {
    setBusy(true)
    try {
      const { authorizationUrl } = await api('/api/billing/checkout', { method: 'POST', body: { plan: chosen, interval } })
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
                  <span className="pay-plan-meta">{item.userLimit >= 2147483647 ? 'Unlimited members' : `Up to ${item.userLimit} members`} · {formatBytes(item.storageLimitBytes)}</span>
                </button>
              )
            })}
          </div>
          <div className="pay-summary">
            <span>Total today</span>
            <strong>{price ? formatPrice(price, plan.currency) : '—'}</strong>
          </div>
          <p className="pay-secure"><Icon name="shield" size={14} />Secured by Paystack — card, bank transfer or USSD. Your plan activates as soon as payment is confirmed.</p>
        </>}
      </div>
      <div className="modal-foot">
        <Button onClick={() => { onClose(); navigate('billing') }} disabled={busy}>See all billing</Button>
        {billing?.paymentsEnabled && <Button variant="primary" icon="shield" onClick={pay} disabled={!price || busy}>{busy ? 'Opening Paystack…' : `Pay ${price ? formatPrice(price, plan.currency) : ''}`}</Button>}
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
    { label: 'Choose a plan', hint: 'Keep growing after your free trial.', done: account.subscription?.status === 'active', action: 'See plans', run: openPayment, icon: 'billing' },
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

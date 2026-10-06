import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { HttpError, appUrl, getSubscription, logActivity, notify, route, withTransaction } from '../lib.js'

// Paystack checkout: the workspace pays on Paystack's page, and OVO activates the plan
// only after confirming the payment with Paystack itself (callback, plus webhook as a backup).
const PAYSTACK = (process.env.PAYSTACK_API_URL || 'https://api.paystack.co').replace(/\/+$/, '')

export function paystackEnabled() {
  return Boolean((process.env.PAYSTACK_SECRET_KEY || '').trim())
}

async function paystack(path, options = {}) {
  const response = await fetch(`${PAYSTACK}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY.trim()}`, 'Content-Type': 'application/json' },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.status === false) {
    console.warn('Paystack refused a request:', path.split('?')[0], response.status, body.message)
    throw new HttpError(502, body.message ? `Paystack: ${body.message}` : 'Paystack could not be reached. Please try again.')
  }
  return body.data
}

const paymentColumns = `id, reference, plan_name AS "plan", billing_interval AS "interval", amount_minor::float / 100 AS amount, seats, purpose,
  currency, status, channel, paid_at AS "paidAt", period_end AS "periodEnd", created_at AS "createdAt"`

// Confirms a payment with Paystack and, the first time it succeeds, activates the plan.
// Safe to call any number of times for the same reference (callback and webhook both do).
export async function confirmPayment(reference) {
  const data = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`)
  return withTransaction(async (client) => {
    const found = await client.query('SELECT * FROM payments WHERE reference = $1 FOR UPDATE', [reference])
    const payment = found.rows[0]
    if (!payment) return { status: 'unknown' }
    if (payment.status === 'success') return { status: 'success', payment }
    // The amount and currency must be exactly what OVO asked for.
    const paid = data.status === 'success' && Number(data.amount) === Number(payment.amount_minor) && data.currency === payment.currency
    if (!paid) {
      // "abandoned" means checkout was opened but not finished yet, so it stays pending.
      if (!['failed', 'reversed', 'success'].includes(data.status)) return { status: 'pending', payment }
      if (data.status === 'success') console.warn(`Payment ${reference} amount or currency did not match; not activated.`)
      await client.query("UPDATE payments SET status = 'failed', channel = $2 WHERE id = $1", [payment.id, data.channel || null])
      return { status: 'failed', payment }
    }
    const plan = await client.query('SELECT id FROM subscription_plans WHERE name = $1', [payment.plan_name])
    if (!plan.rowCount) throw new Error(`Paid plan ${payment.plan_name} no longer exists`)
    // Extra people bought mid-period: more room, same end date.
    if (payment.purpose === 'seats') {
      const updated = await client.query(
        'UPDATE subscriptions SET seats = GREATEST(COALESCE(seats, 0), $2) WHERE organization_id = $1 RETURNING current_period_end',
        [payment.organization_id, payment.seats],
      )
      const periodEnd = updated.rows[0]?.current_period_end
      await client.query(
        "UPDATE payments SET status = 'success', channel = $2, paid_at = COALESCE($3::timestamptz, now()), period_end = $4 WHERE id = $1",
        [payment.id, data.channel || null, data.paid_at || null, periodEnd],
      )
      if (payment.created_by) await logActivity(client, { organizationId: payment.organization_id, userId: payment.created_by }, `added room for ${payment.seats} people`, 'billing', payment.reference)
      return { status: 'success', payment: { ...payment, period_end: periodEnd } }
    }
    // A renewal adds time after the current paid period; an upgrade or lapsed plan starts today.
    const step = payment.billing_interval === 'yearly' ? '1 year' : '1 month'
    const updated = await client.query(
      `UPDATE subscriptions SET
         current_period_end = CASE WHEN plan_id = $2 AND status = 'active' AND current_period_end > now()
                                   THEN current_period_end ELSE now() END + $3::interval,
         plan_id = $2, status = 'active', seats = $4
       WHERE organization_id = $1 RETURNING current_period_end`,
      [payment.organization_id, plan.rows[0].id, step, payment.seats],
    )
    const periodEnd = updated.rows[0]?.current_period_end
    await client.query(
      "UPDATE payments SET status = 'success', channel = $2, paid_at = COALESCE($3::timestamptz, now()), period_end = $4 WHERE id = $1",
      [payment.id, data.channel || null, data.paid_at || null, periodEnd],
    )
    const auth = { organizationId: payment.organization_id, userId: payment.created_by }
    if (payment.created_by) await logActivity(client, auth, `paid for the ${payment.plan_name} plan`, 'billing', payment.reference)
    const admins = await client.query("SELECT user_id FROM organization_members WHERE organization_id = $1 AND role IN ('owner', 'admin')", [payment.organization_id])
    for (const admin of admins.rows) {
      await notify(client, payment.organization_id, admin.user_id, {
        title: `Payment received — ${payment.plan_name} plan is active`,
        message: `Paid until ${new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
        resourceType: 'billing',
        link: '#/billing',
      })
    }
    return { status: 'success', payment: { ...payment, period_end: periodEnd } }
  })
}

// ---------------------------------------------------------------- Public: Paystack returns here
export const publicBillingRouter = express.Router()
const callbackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false })

publicBillingRouter.get('/billing/paystack/callback', callbackLimiter, async (request, response) => {
  const reference = String(request.query.reference || request.query.trxref || '')
  if (!paystackEnabled() || !/^ovo_[A-Za-z0-9_-]{8,64}$/.test(reference)) return response.redirect(303, '/#/billing?payment=failed')
  try {
    const result = await confirmPayment(reference)
    return response.redirect(303, `/#/billing?payment=${result.status === 'success' ? 'success' : result.status === 'pending' ? 'pending' : 'failed'}`)
  } catch (error) {
    console.warn('Payment confirmation failed:', error.message)
    return response.redirect(303, '/#/billing?payment=pending')
  }
})

// Paystack signs each webhook with the secret key (HMAC-SHA512 of the raw body).
publicBillingRouter.post('/billing/paystack/webhook', async (request, response) => {
  if (!paystackEnabled() || !request.rawBody) return response.status(404).end()
  const expected = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY.trim()).update(request.rawBody).digest()
  const given = Buffer.from(String(request.get('x-paystack-signature') || ''), 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return response.status(401).end()
  const reference = request.body?.data?.reference
  if (request.body?.event === 'charge.success' && typeof reference === 'string' && reference.startsWith('ovo_')) {
    try {
      await confirmPayment(reference)
    } catch (error) {
      console.warn('Webhook confirmation failed:', error.message)
      return response.status(500).end()
    }
  }
  return response.status(200).end()
})

// ---------------------------------------------------------------- Workspace owners and admins
const router = express.Router()
router.use(requireAuth)
const adminsOnly = requireRole('owner', 'admin')

// The price of a plan for a number of people: the base price covers the plan's included people,
// each extra person costs extra_user_price a month (yearly is 10 months, so 2 are free).
export function planAmount(plan, interval, seats) {
  const base = interval === 'yearly' ? plan.yearly : plan.monthly
  const extra = Math.max(0, seats - plan.included) * (plan.extraUserPrice || 0) * (interval === 'yearly' ? 10 : 1)
  return base + extra
}

const planRow = async (name) => (await pool.query(
  `SELECT name, monthly_price::float AS monthly, yearly_price::float AS yearly, currency, user_limit AS "userLimit",
          COALESCE(included_users, user_limit) AS included, extra_user_price::float AS "extraUserPrice"
   FROM subscription_plans WHERE name = $1 AND active`,
  [name],
)).rows[0]

async function headcount(organizationId) {
  const result = await pool.query(
    `SELECT (SELECT count(*)::int FROM organization_members WHERE organization_id = $1)
          + (SELECT count(*)::int FROM invitations WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > now()) AS people`,
    [organizationId],
  )
  return result.rows[0].people
}

async function startCheckout(request, { plan, interval, seats, purpose, amount }) {
  const amountMinor = Math.round(amount * 100)
  const reference = `ovo_${randomBytes(12).toString('base64url')}`
  await pool.query(
    `INSERT INTO payments (organization_id, reference, plan_name, billing_interval, amount_minor, currency, created_by, seats, purpose)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [request.auth.organizationId, reference, plan.name, interval, amountMinor, plan.currency, request.auth.userId, seats, purpose],
  )
  const label = purpose === 'seats' ? `${plan.name} — room for ${seats} people` : `${plan.name} (${interval}, ${seats} people)`
  const data = await paystack('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: request.auth.email,
      amount: amountMinor,
      currency: plan.currency,
      reference,
      callback_url: appUrl(request, '/api/billing/paystack/callback'),
      metadata: {
        organization_id: request.auth.organizationId,
        organization: request.auth.organizationName,
        plan: plan.name,
        interval,
        seats,
        purpose,
        custom_fields: [
          { display_name: 'Workspace', variable_name: 'workspace', value: request.auth.organizationName },
          { display_name: 'Plan', variable_name: 'plan', value: label },
        ],
      },
    }),
  })
  return { authorizationUrl: data.authorization_url, reference }
}

router.post('/billing/checkout', adminsOnly, route(async (request, response) => {
  if (!paystackEnabled()) throw new HttpError(400, 'Online payment isn’t set up yet. Contact OVO to upgrade.')
  const values = z.object({
    plan: z.string().trim().min(1).max(60),
    interval: z.enum(['monthly', 'yearly']),
    seats: z.number().int().min(1).max(100000).optional(),
  }).parse(request.body)
  const plan = await planRow(values.plan)
  if (!plan) throw new HttpError(404, 'That plan isn’t available.')
  const price = values.interval === 'yearly' ? plan.yearly : plan.monthly
  if (plan.name === 'Free') throw new HttpError(400, 'The Free plan doesn’t need payment. Workspaces move to it automatically when a paid plan ends.')
  if (!price) throw new HttpError(400, `The ${plan.name} plan has custom pricing. Contact OVO to arrange it.`)
  const people = await headcount(request.auth.organizationId)
  // Without extra-person pricing, the plan is a fixed size.
  const seats = plan.extraUserPrice ? Math.max(plan.included, values.seats ?? people) : plan.included
  if (seats > plan.userLimit) throw new HttpError(400, `The ${plan.name} plan goes up to ${plan.userLimit} people. Contact OVO for more.`)
  if (seats < people) throw new HttpError(400, `You have ${people} people (including pending invitations). Choose room for at least ${people}, or remove some first.`)
  return response.json(await startCheckout(request, { plan, interval: values.interval, seats, purpose: 'plan', amount: planAmount(plan, values.interval, seats) }))
}))

// The cost of adding people to a paid plan for the rest of its current period.
function seatQuote(subscription, plan, seats) {
  const added = seats - subscription.memberLimit
  const daysLeft = Math.max(1, Math.ceil((new Date(subscription.current_period_end).getTime() - Date.now()) / 86400000))
  // Priced by the day at the monthly rate; over a long (yearly) period, at the yearly rate.
  const perDay = (plan.extraUserPrice / 30) * (daysLeft > 31 ? 10 / 12 : 1)
  return { added, daysLeft, amount: Math.max(100, Math.round(added * perDay * daysLeft)) }
}

async function seatContext(request, seats) {
  const subscription = await getSubscription(pool, request.auth.organizationId)
  const plan = subscription && await planRow(subscription.plan_name)
  if (!subscription || !plan || subscription.status !== 'active' || !plan.extraUserPrice || !subscription.current_period_end || new Date(subscription.current_period_end) < new Date()) {
    throw new HttpError(400, 'Adding people is available on an active paid plan. Choose a plan first.')
  }
  if (seats <= subscription.memberLimit) throw new HttpError(400, `Your plan already has room for ${subscription.memberLimit} people.`)
  if (seats > plan.userLimit) throw new HttpError(400, `The ${plan.name} plan goes up to ${plan.userLimit} people. Contact OVO for more.`)
  return { subscription, plan }
}

router.get('/billing/seats/quote', adminsOnly, route(async (request, response) => {
  const seats = z.coerce.number().int().min(1).max(100000).parse(request.query.seats)
  const { subscription, plan } = await seatContext(request, seats)
  return response.json({ ...seatQuote(subscription, plan, seats), seats, currency: plan.currency })
}))

router.post('/billing/seats', adminsOnly, route(async (request, response) => {
  if (!paystackEnabled()) throw new HttpError(400, 'Online payment isn’t set up yet. Contact OVO to add people.')
  const { seats } = z.object({ seats: z.number().int().min(1).max(100000) }).parse(request.body)
  const { subscription, plan } = await seatContext(request, seats)
  const { amount } = seatQuote(subscription, plan, seats)
  return response.json(await startCheckout(request, { plan, interval: 'monthly', seats, purpose: 'seats', amount }))
}))

// Checks a payment the browser came back from, in case the callback ran before Paystack finished.
router.post('/billing/payments/:reference/verify', adminsOnly, route(async (request, response) => {
  const owned = await pool.query('SELECT 1 FROM payments WHERE reference = $1 AND organization_id = $2', [request.params.reference, request.auth.organizationId])
  if (!owned.rowCount) throw new HttpError(404, 'Payment not found.')
  const result = await confirmPayment(request.params.reference)
  return response.json({ status: result.status })
}))

router.get('/billing/payments', adminsOnly, route(async (request, response) => {
  const result = await pool.query(
    `SELECT ${paymentColumns} FROM payments WHERE organization_id = $1 AND (status <> 'pending' OR created_at > now() - interval '1 day')
     ORDER BY created_at DESC LIMIT 50`,
    [request.auth.organizationId],
  )
  return response.json({ payments: result.rows })
}))

export default router

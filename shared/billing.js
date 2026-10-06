// OVO pricing, shared by the server (what to charge) and the browser (what to show).

// How long a workspace can pay for at once, and the discount for paying ahead.
// A year is charged as 10 months (2 months free).
export const BILLING_PERIODS = [
  { value: 'monthly', label: 'Monthly', short: 'month', months: 1, monthsCharged: 1, saving: '' },
  { value: 'quarterly', label: '3 months', short: '3 months', months: 3, monthsCharged: 2.85, saving: 'Save 5%' },
  { value: 'biannual', label: '6 months', short: '6 months', months: 6, monthsCharged: 5.4, saving: 'Save 10%' },
  { value: 'yearly', label: '1 year', short: 'year', months: 12, monthsCharged: 10, saving: '2 months free' },
]

export const BILLING_PERIOD_VALUES = BILLING_PERIODS.map((period) => period.value)

export function billingPeriod(value) {
  return BILLING_PERIODS.find((period) => period.value === value) || BILLING_PERIODS[0]
}

// The price of a plan for one billing period and a number of people.
// `plan` uses the API's field names: monthlyPrice, yearlyPrice, includedUsers, extraUserPrice.
// Returns null for plans with custom pricing.
export function planAmount(plan, periodValue, seats = 0) {
  if (!plan.monthlyPrice) return null
  const period = billingPeriod(periodValue)
  const base = period.value === 'yearly' && plan.yearlyPrice ? plan.yearlyPrice : plan.monthlyPrice * period.monthsCharged
  const extraPeople = Math.max(0, seats - (plan.includedUsers || 0))
  return Math.round(base + extraPeople * (plan.extraUserPrice || 0) * period.monthsCharged)
}

// What each package is for and what comes with it, beyond the limits set in the console.
export const PLAN_DETAILS = {
  Free: {
    label: 'Try it out',
    tagline: 'For very small teams getting organised.',
    highlights: [
      'Sheets, tasks, projects, calendar and clients',
      'Team chat and direct messages',
      'Files, Document Vault and share links',
      'Daily task updates and personal weekly reports',
    ],
  },
  Starter: {
    label: 'A place to start',
    tagline: 'For small teams bringing their work into one place.',
    highlights: [
      'Everything in Free',
      'Add more people any time',
      'Email support',
    ],
  },
  Business: {
    label: 'Most popular',
    tagline: 'For growing teams that need to see everyone’s progress.',
    highlights: [
      'Everything in Starter',
      'Priority support',
    ],
  },
  Enterprise: {
    label: 'Built around you',
    tagline: 'For large teams and organisations with special needs.',
    highlights: [
      'Everything in Business',
      'Custom number of people and storage',
      'Onboarding and training for your team',
      'Dedicated account manager',
      'Invoice and bank-transfer billing',
    ],
  },
}

const UNLIMITED = 2147483647

// The plan's limits in plain words, followed by its highlights.
export function planIncludes(plan, formatPrice, formatBytes) {
  const features = plan.features || {}
  const people = plan.userLimit >= UNLIMITED && !plan.extraUserPrice
    ? 'Unlimited people'
    : plan.extraUserPrice
      ? `${plan.includedUsers} people included, +${formatPrice(plan.extraUserPrice, plan.currency)} per extra person a month`
      : `Up to ${plan.includedUsers} people`
  // Limits: unlimited ones are grouped into one line.
  const limits = [['project', plan.projectLimit], ['form', features.forms], ['automation', features.automations]]
  const unlimited = limits.filter(([, value]) => value === null || value === undefined).map(([noun]) => `${noun}s`)
  const counted = limits.filter(([, value]) => value !== null && value !== undefined).map(([noun, value]) => `${value} ${value === 1 ? noun : `${noun}s`}`)
  const joinWords = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0])
  return [
    people,
    `${formatBytes(plan.storageLimitBytes)} file storage`,
    ...(PLAN_DETAILS[plan.name]?.highlights || []),
    ...(unlimited.length ? [`Unlimited ${joinWords(unlimited)}`] : []),
    ...(counted.length ? [joinWords(counted)] : []),
    ...(features.reports === false ? [] : ['Team daily & weekly reports']),
    features.chatHistoryDays ? `${features.chatHistoryDays}-day chat history` : 'Full chat history',
  ]
}

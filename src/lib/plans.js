import { BILLING_PERIODS, PLAN_DETAILS, billingPeriod, planAmount, planIncludes } from '../../shared/billing.js'
import { formatBytes, formatPrice } from './format.js'

export { BILLING_PERIODS, PLAN_DETAILS, billingPeriod, planAmount }

// Everything a plan comes with, in plain words.
export const includesList = (plan) => planIncludes(plan, formatPrice, formatBytes)

// Options for a period picker: "3 months · Save 5%".
export const periodOptions = BILLING_PERIODS.map((period) => ({ value: period.value, label: period.saving ? `${period.label} · ${period.saving}` : period.label }))

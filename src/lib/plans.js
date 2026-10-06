import { formatPrice } from './format.js'

const UNLIMITED = 2147483647

// What a plan covers, in plain words: "5 people included · +₦2,500 per extra person".
export function planPeople(plan) {
  if (plan.userLimit >= UNLIMITED && !plan.extraUserPrice) return 'Unlimited people'
  const included = `${plan.includedUsers} ${plan.includedUsers === 1 ? 'person' : 'people'} included`
  return plan.extraUserPrice ? `${included} · +${formatPrice(plan.extraUserPrice, plan.currency)} per extra person/month` : `Up to ${plan.includedUsers} people`
}

// Same sum as the server: base price plus extra people (a year is billed as 10 months).
export function planTotal(plan, interval, seats) {
  const base = interval === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice
  if (!base) return null
  return base + Math.max(0, seats - plan.includedUsers) * (plan.extraUserPrice || 0) * (interval === 'yearly' ? 10 : 1)
}

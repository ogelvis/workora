import { useEffect } from 'react'
import { BrandMark } from '../components/ui.jsx'
import { LEGAL_CONTACT_EMAIL, LEGAL_EFFECTIVE, LEGAL_ENTITY } from '../../shared/legal.js'
import './public.css'

const mail = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>

const TERMS = [
  ['1. About these terms', <>These Terms of Use (“Terms”) are an agreement between you and {LEGAL_ENTITY} (“OVO”, “we”, “us”) for the use of the OVO workspace platform, its website and related services (the “Service”). By creating a workspace, accepting an invitation or otherwise using the Service, you agree to these Terms and to our <a href="/privacy">Privacy Policy</a>. If you use OVO on behalf of a business, you confirm you are authorised to accept these Terms for it.</>],
  ['2. Your account', <>You must give accurate information when you register and keep it up to date. You are responsible for keeping your password safe and for everything that happens under your account. Tell us straight away at {mail} if you think your account has been used without permission. You must be at least 18 years old to create a workspace.</>],
  ['3. Workspaces and roles', <>The person who creates a workspace is its owner. Owners and admins decide who joins, what role they have and what they can see. Owners are responsible for the people they invite and for making sure their team uses OVO in line with these Terms.</>],
  ['4. Your content', <>Everything your organisation adds to OVO — records, sheets, files, messages, form responses and other data (“Your Content”) — remains yours. You give us permission to store, process and display Your Content only as needed to run, secure and improve the Service for you. You are responsible for having the right to upload Your Content, including any personal data about your clients or staff, and for using OVO Forms and secure share links lawfully.</>],
  ['5. Acceptable use', <>You agree not to: break any law or anyone’s rights; upload malware or harmful code; try to access accounts, workspaces or systems you are not allowed to; overload, probe or disrupt the Service; send spam or unlawful content through forms, sharing or announcements; or resell the Service without our written permission. We may suspend accounts that put the Service or other customers at risk.</>],
  ['6. Plans, trials and payment', <>New workspaces start with a free trial. After the trial, continued use of paid features requires a paid plan. Prices are shown in the app and on our website and may change with at least 30 days’ notice. Fees are charged in advance for each billing period and, unless required by law, are non-refundable. If a payment fails, we may limit or suspend the workspace until it is settled; your data is kept safe during that time.</>],
  ['7. Availability and changes', <>We work hard to keep OVO available and secure, but the Service is provided “as is” and may occasionally be interrupted for maintenance or reasons outside our control. We may add, change or remove features. We will tell you about important changes through product or service announcements.</>],
  ['8. Cancelling and deleting data', <>Workspace owners can stop using OVO at any time. We may suspend or end access if these Terms are seriously or repeatedly broken, or if payment is overdue. After a workspace is closed, we may delete Your Content after a reasonable period. Export anything you want to keep before closing a workspace.</>],
  ['9. Liability', <>To the fullest extent allowed by law, OVO is not liable for indirect or consequential losses, lost profits or lost data, and our total liability for any claim is limited to the amount you paid us in the 12 months before the claim. Nothing in these Terms limits liability that cannot be limited by law.</>],
  ['10. Changes to these terms', <>We may update these Terms from time to time. When we make material changes we will notify you by email and inside OVO, and ask you to accept the new version before you continue using the Service.</>],
  ['11. Governing law and contact', <>These Terms are governed by the laws of the Federal Republic of Nigeria, and the courts of Nigeria have jurisdiction over any dispute. Questions about these Terms? Contact us at {mail}.</>],
]

const PRIVACY = [
  ['1. Who we are', <>This Privacy Policy explains how {LEGAL_ENTITY} (“OVO”, “we”, “us”) collects and uses personal data when you use the OVO platform and website. We process personal data in line with the Nigeria Data Protection Act 2023 and other laws that apply.</>],
  ['2. What we collect', <>
    <b>Account information</b> — your name, email address, password (stored only as a secure hash), role and the workspace you belong to.<br />
    <b>Business information</b> — your organisation’s name, business email, phone, website, address and industry.<br />
    <b>Workspace content</b> — the records, files, messages, tasks, form responses and other data you and your team add.<br />
    <b>Usage and security data</b> — sign-in sessions, activity in your workspace and basic technical information needed to keep the Service secure.<br />
    <b>Billing information</b> — your plan and payment status. Card details are handled by our payment provider and never stored by OVO.
  </>],
  ['3. How we use it', <>We use personal data to provide and secure the Service; create and manage accounts; send service emails such as sign-in links, password resets and security, policy or service notices; send product updates (you can turn these off in Settings → My account); provide support; process payments; and meet our legal obligations. We do not sell personal data.</>],
  ['4. Your organisation’s data', <>When your organisation adds information about its clients, staff or others to OVO, the organisation decides why and how that data is used, and OVO processes it on the organisation’s behalf. Requests about that data should first go to the organisation that holds it.</>],
  ['5. Who we share it with', <>We share personal data only with trusted providers that help us run OVO — for example cloud hosting and database providers, email delivery and payment processing — under agreements that require them to protect it, and when the law requires us to. Some providers may store data outside Nigeria; where that happens we take steps to keep it adequately protected.</>],
  ['6. How long we keep it', <>We keep personal data for as long as your account or workspace is active and as needed to provide the Service, resolve disputes and meet legal requirements. When a workspace is closed, its data is deleted after a reasonable period.</>],
  ['7. Security', <>We protect data with encrypted connections, hashed passwords, access controls by role, private document vaults and audit logs. No system is perfectly secure, so please use a strong password and tell us at once if you suspect a problem.</>],
  ['8. Your rights', <>You can ask to access, correct or delete your personal data, object to or restrict certain processing, withdraw consent where we rely on it, and ask for a copy of your data. You can update your name and email yourself in Settings → My account. To make any other request, contact {mail}. You may also complain to the Nigeria Data Protection Commission.</>],
  ['9. Cookies', <>OVO uses a single essential cookie to keep you signed in securely. We do not use advertising cookies.</>],
  ['10. Changes and contact', <>We may update this policy. If the changes are material, we will tell you by email and inside OVO. Questions? Contact us at {mail}.</>],
]

// Public /terms and /privacy pages.
export default function Legal({ page }) {
  const terms = page === 'terms'
  const title = terms ? 'Terms of Use' : 'Privacy Policy'
  useEffect(() => { document.title = `${title} · OVO` }, [title])
  return (
    <div className="legal">
      <header className="legal-top">
        <a href="/" aria-label="OVO home"><BrandMark size={30} /></a>
        <nav><a href="/terms" className={terms ? 'active' : ''}>Terms of Use</a><a href="/privacy" className={terms ? '' : 'active'}>Privacy Policy</a></nav>
      </header>
      <main className="legal-doc">
        <span className="legal-eyebrow">Legal</span>
        <h1>{title}</h1>
        <p className="legal-date">Effective {LEGAL_EFFECTIVE}</p>
        {(terms ? TERMS : PRIVACY).map(([heading, body]) => (
          <section key={heading}><h2>{heading}</h2><p>{body}</p></section>
        ))}
      </main>
      <footer className="legal-foot">© {new Date().getFullYear()} OVO · One Vision. One Organization.</footer>
    </div>
  )
}

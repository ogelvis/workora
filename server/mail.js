import nodemailer from 'nodemailer'

// Outgoing email. Configure one of:
//   RESEND_API_KEY (https://resend.com), or
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (any mailbox, e.g. your domain's email hosting)
// plus EMAIL_FROM, e.g. "OVO <hello@yourdomain.com>".
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST)
}

function sender() {
  return (process.env.EMAIL_FROM || process.env.SUPPORT_EMAIL || '').trim()
}

let transport
function smtp() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465)
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  }
  return transport
}

// Never throws: returns { sent: true } or { sent: false, reason } so callers can fall back to a copyable link.
export async function sendMail({ to, subject, html, text }) {
  if (!emailConfigured()) return { sent: false, reason: 'Email sending is not set up yet (add RESEND_API_KEY or SMTP settings in Vercel).' }
  if (!sender()) return { sent: false, reason: 'EMAIL_FROM is not set.' }
  try {
    if (process.env.RESEND_API_KEY) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sender(), to: [to], subject, html, text }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        console.warn('Resend refused the email:', response.status, detail.slice(0, 300))
        return { sent: false, reason: `The email service refused the message (HTTP ${response.status}).` }
      }
      return { sent: true }
    }
    await smtp().sendMail({ from: sender(), to, subject, html, text })
    return { sent: true }
  } catch (error) {
    console.warn('Email failed:', error.message)
    return { sent: false, reason: 'The email could not be sent. Check the email settings.' }
  }
}

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

export function welcomeEmail({ fullName, organizationName, link, expiresAt }) {
  const first = fullName.split(' ')[0]
  const until = new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const text = `Hello ${first},

Your OVO workspace for ${organizationName} is ready.

Open your workspace: ${link}

The link signs you straight in and works once, until ${until}. Inside, choose a password under Settings → Security so you can sign in again any time.

— The OVO team
One Vision. One Organization.`
  const html = `<!doctype html><html><body style="margin:0;background:#f7f6fb;font-family:Segoe UI,Arial,sans-serif;color:#1c1a33">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e3f0">
      <tr><td style="background:linear-gradient(135deg,#6a3df5,#4318c9);padding:28px 32px;color:#ffffff">
        <div style="font-size:28px;font-weight:800;letter-spacing:-1px">OVO</div>
        <div style="font-size:11px;letter-spacing:2px;opacity:.8;margin-top:4px">ONE VISION. ONE ORGANIZATION.</div>
      </td></tr>
      <tr><td style="padding:30px 32px">
        <h1 style="font-size:22px;margin:0 0 12px">Welcome, ${escape(first)} 👋</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 22px">Your OVO workspace for <strong>${escape(organizationName)}</strong> is ready. Click below to go straight to your dashboard — no sign-up needed.</p>
        <a href="${escape(link)}" style="display:inline-block;background:#5b2ef0;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:11px;font-size:15px">Open my workspace</a>
        <p style="font-size:13px;line-height:1.6;color:#6b6883;margin:22px 0 0">This link signs you in once and expires on ${escape(until)}. Once inside, set a password under <strong>Settings → Security</strong> so you can sign in again any time.</p>
        <p style="font-size:12px;color:#8d8aa3;margin:18px 0 0;word-break:break-all">If the button doesn't work, paste this into your browser:<br>${escape(link)}</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`
  return { subject: `Your OVO workspace for ${organizationName} is ready`, text, html }
}

export function ownerResetEmail({ fullName, link }) {
  const first = (fullName || 'there').split(' ')[0]
  const text = `Hello ${first},

Someone asked to reset the password for the OVO owner console.

Choose a new password: ${link}

The link works once and expires in 1 hour. If you didn't ask for this, ignore this email; your password stays the same.

— OVO`
  const html = `<!doctype html><html><body style="margin:0;background:#f7f6fb;font-family:Segoe UI,Arial,sans-serif;color:#1c1a33">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e3f0">
      <tr><td style="background:#14112b;padding:24px 32px;color:#ffffff">
        <div style="font-size:24px;font-weight:800;letter-spacing:-1px">OVO <span style="font-size:11px;letter-spacing:2px;color:#c9b8ff;font-weight:700">CONTROL</span></div>
      </td></tr>
      <tr><td style="padding:30px 32px">
        <h1 style="font-size:20px;margin:0 0 12px">Reset your owner password</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 22px">Hello ${escape(first)}, use the button below to choose a new password for the OVO owner console.</p>
        <a href="${escape(link)}" style="display:inline-block;background:#5b2ef0;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:11px;font-size:15px">Choose a new password</a>
        <p style="font-size:13px;line-height:1.6;color:#6b6883;margin:22px 0 0">The link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email — your password stays the same.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`
  return { subject: 'Reset your OVO owner password', text, html }
}

function simpleEmail({ heading, body, button, link, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f7f6fb;font-family:Segoe UI,Arial,sans-serif;color:#1c1a33">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e3f0">
      <tr><td style="background:linear-gradient(135deg,#6a3df5,#4318c9);padding:24px 32px;color:#ffffff"><div style="font-size:26px;font-weight:800;letter-spacing:-1px">OVO</div></td></tr>
      <tr><td style="padding:30px 32px">
        <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 22px">${body}</p>
        ${button ? `<a href="${escape(link)}" style="display:inline-block;background:#5b2ef0;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:11px;font-size:15px">${button}</a>` : ''}
        <p style="font-size:13px;line-height:1.6;color:#6b6883;margin:22px 0 0">${footer}</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`
}

export function verifyEmailChangeEmail({ fullName, newEmail, link }) {
  const first = (fullName || 'there').split(' ')[0]
  const text = `Hello ${first},

Confirm ${newEmail} as your new OVO sign-in email: ${link}

The link expires in 24 hours. Until you confirm, you keep signing in with your current email. If you didn't ask for this, ignore this email.

— OVO`
  const html = simpleEmail({
    heading: 'Confirm your new email',
    body: `Hello ${escape(first)}, click below to make <strong>${escape(newEmail)}</strong> your OVO sign-in email.`,
    button: 'Confirm my new email',
    link,
    footer: 'The link expires in 24 hours. Until you confirm, you keep signing in with your current email. If you didn’t ask for this, ignore this email.',
  })
  return { subject: 'Confirm your new OVO email', text, html }
}

export function emailChangedEmail({ fullName, newEmail }) {
  const first = (fullName || 'there').split(' ')[0]
  const text = `Hello ${first},

Your OVO sign-in email was changed to ${newEmail}. From now on, sign in with that address.

If you didn't make this change, contact your workspace owner or OVO support straight away.

— OVO`
  const html = simpleEmail({
    heading: 'Your sign-in email changed',
    body: `Hello ${escape(first)}, your OVO sign-in email is now <strong>${escape(newEmail)}</strong>. Use it the next time you sign in.`,
    footer: 'If you didn’t make this change, contact your workspace owner or OVO support straight away.',
  })
  return { subject: 'Your OVO sign-in email was changed', text, html }
}

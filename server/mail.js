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

// Sends many emails. Resend takes up to 100 per request; SMTP goes a few at a time.
// Never throws: returns how many were accepted and how many failed.
export async function sendBatch(messages) {
  if (!messages.length) return { sent: 0, failed: 0 }
  if (!emailConfigured() || !sender()) return { sent: 0, failed: messages.length, reason: 'Email sending is not set up yet.' }
  let sent = 0
  let failed = 0
  if (process.env.RESEND_API_KEY) {
    for (let start = 0; start < messages.length; start += 100) {
      const chunk = messages.slice(start, start + 100)
      try {
        const response = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk.map(({ to, subject, html, text }) => ({ from: sender(), to: [to], subject, html, text }))),
        })
        if (response.ok) sent += chunk.length
        else {
          failed += chunk.length
          console.warn('Resend refused a batch:', response.status, (await response.text().catch(() => '')).slice(0, 300))
        }
      } catch (error) {
        failed += chunk.length
        console.warn('Batch email failed:', error.message)
      }
    }
    return { sent, failed }
  }
  for (let start = 0; start < messages.length; start += 5) {
    const results = await Promise.all(messages.slice(start, start + 5).map((message) => sendMail(message)))
    for (const result of results) {
      if (result.sent) sent++
      else failed++
    }
  }
  return { sent, failed }
}

export const ANNOUNCEMENT_CATEGORIES = {
  product: { label: 'Product update', color: '#5b2ef0', why: 'You’re receiving this product update because you have an OVO account.' },
  policy: { label: 'Policy update', color: '#0f766e', why: 'You’re receiving this mandatory service announcement to update you about important changes to OVO’s terms or policies.' },
  security: { label: 'Security notice', color: '#b4233c', why: 'You’re receiving this mandatory security notice because you have an OVO account.' },
  service: { label: 'Service notice', color: '#a8620c', why: 'You’re receiving this mandatory service announcement about your OVO account.' },
  message: { label: 'Message from OVO', color: '#1d5fd1', why: 'You’re receiving this message from the OVO team about your account.' },
}

// Plain text in, safe email HTML out: blank lines make paragraphs, "- " lines make bullet lists.
function formatBody(body) {
  return body.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length && lines.every((line) => /^[-•*]\s+/.test(line))) {
      return `<ul style="margin:0 0 16px;padding-left:20px">${lines.map((line) => `<li style="font-size:15px;line-height:1.6;margin:0 0 6px">${escape(line.replace(/^[-•*]\s+/, ''))}</li>`).join('')}</ul>`
    }
    return `<p style="font-size:15px;line-height:1.65;margin:0 0 16px">${lines.map(escape).join('<br>')}</p>`
  }).join('')
}

export function announcementEmail({ category, title, body, ctaLabel, ctaUrl, fullName, appUrl: appLink, preferencesUrl }) {
  const info = ANNOUNCEMENT_CATEGORIES[category] || ANNOUNCEMENT_CATEGORIES.service
  const first = (fullName || '').split(' ')[0]
  const greeting = first ? `Hi ${first},` : 'Hello,'
  const optional = category === 'product'
  const text = `${info.label.toUpperCase()}

${title}

${greeting}

${body.trim()}
${ctaLabel && ctaUrl ? `\n${ctaLabel}: ${ctaUrl}\n` : ''}
— The OVO team
One Vision. One Organization.

${info.why}${optional ? ` To stop receiving product updates, go to Settings → My account: ${preferencesUrl}` : ''}`
  const html = `<!doctype html><html><body style="margin:0;background:#f4f3f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1a33">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding:0 4px 18px"><span style="font-size:26px;font-weight:800;letter-spacing:-1px;color:#5b2ef0">OVO</span></td></tr>
      <tr><td style="background:#ffffff;border-radius:18px;border:1px solid #e6e3f0;overflow:hidden">
        <div style="height:5px;background:${info.color}"></div>
        <div style="padding:30px 34px 32px">
          <span style="display:inline-block;background:${info.color}14;color:${info.color};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:5px 10px;border-radius:999px">${info.label}</span>
          <h1 style="font-size:24px;line-height:1.3;margin:16px 0 18px;color:#14112b">${escape(title)}</h1>
          <p style="font-size:15px;line-height:1.65;margin:0 0 16px">${escape(greeting)}</p>
          ${formatBody(body)}
          ${ctaLabel && ctaUrl ? `<a href="${escape(ctaUrl)}" style="display:inline-block;background:#5b2ef0;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:11px;font-size:15px;margin:6px 0 4px">${escape(ctaLabel)}</a>` : ''}
          <p style="font-size:15px;line-height:1.6;margin:22px 0 0">— The OVO team</p>
        </div>
      </td></tr>
      <tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.6;color:#8d8aa3;text-align:center">
        ${escape(info.why)}${optional ? ` <a href="${escape(preferencesUrl)}" style="color:#5b2ef0">Manage email preferences</a>.` : ''}<br>
        <a href="${escape(appLink)}" style="color:#8d8aa3">OVO</a> · One Vision. One Organization.
      </td></tr>
    </table>
  </td></tr></table></body></html>`
  return { subject: category === 'product' || category === 'message' ? title : `[${info.label}] ${title}`, text, html }
}

const ROLE_WORDS = { admin: 'an admin', manager: 'a manager', staff: 'a team member' }

export function inviteEmail({ inviterName, organizationName, role, link, expiresAt }) {
  const until = new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const as = ROLE_WORDS[role] || 'a team member'
  const text = `Hello,

${inviterName} has invited you to join ${organizationName} on OVO as ${as}.

Accept the invitation: ${link}

It only takes a minute: enter your name, choose a password and you're in. The link works once and expires on ${until}.

— The OVO team
One Vision. One Organization.`
  const html = simpleEmail({
    heading: `Join ${escape(organizationName)} on OVO`,
    body: `<strong>${escape(inviterName)}</strong> has invited you to join <strong>${escape(organizationName)}</strong> as ${as}. OVO is where the team keeps its clients, tasks, files and messages in one place.<br><br>It takes a minute: enter your name, choose a password and you’re in.`,
    button: 'Accept invitation',
    link,
    footer: `This link works once and expires on ${escape(until)}. If you weren’t expecting it, you can ignore this email.`,
  })
  return { subject: `${inviterName} invited you to ${organizationName} on OVO`, text, html }
}

export function passwordResetEmail({ fullName, link }) {
  const first = (fullName || 'there').split(' ')[0]
  const text = `Hello ${first},

Someone asked to reset your OVO password.

Choose a new password: ${link}

The link works once and expires in 1 hour. If you didn't ask for this, ignore this email; your password stays the same.

— OVO`
  const html = simpleEmail({
    heading: 'Reset your password',
    body: `Hello ${escape(first)}, click below to choose a new password for OVO.`,
    button: 'Choose a new password',
    link,
    footer: 'The link works once and expires in 1 hour. If you didn’t ask for this, you can ignore this email — your password stays the same.',
  })
  return { subject: 'Reset your OVO password', text, html }
}

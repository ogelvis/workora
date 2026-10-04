import { useEffect, useState } from 'react'
import './LandingPage.css'
import { formatBytes, formatPrice } from './lib/format.js'

const previewTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'files', label: 'Files' },
  { key: 'projects', label: 'Projects' },
  { key: 'team', label: 'Team chat' },
  { key: 'vault', label: 'Vault' },
]

function PreviewContent({ activeTab }) {
  if (activeTab === 'files') {
    return (
      <div className="lp-file-view">
        <div className="lp-preview-heading"><div><small>Workspace / Files</small><strong>Company files</strong></div><span className="lp-mini-action">↑ Upload</span></div>
        <div className="lp-folder-row"><span>▰ Brand &amp; Marketing</span><span>▰ Client work</span><span>▰ Finance</span><span>▰ People &amp; HR</span></div>
        <div className="lp-file-table">
          <div className="lp-table-head"><span>Name</span><span>Updated</span><span>Size</span></div>
          <div><span><i className="lp-file-icon pdf">PDF</i> Brand guidelines.pdf</span><span>Today, 10:42</span><span>4.2 MB</span></div>
          <div><span><i className="lp-file-icon doc">DOC</i> Q4 campaign brief.docx</span><span>Yesterday</span><span>1.8 MB</span></div>
          <div><span><i className="lp-file-icon img">IMG</i> Product photography.zip</span><span>Oct 01</span><span>28 MB</span></div>
        </div>
      </div>
    )
  }
  if (activeTab === 'projects') {
    return (
      <div className="lp-project-view">
        <div className="lp-preview-heading"><div><small>Workspace / Projects</small><strong>Project overview</strong></div><span className="lp-mini-action">+ New project</span></div>
        <div className="lp-project-card"><div><b>Website redesign</b><span>ABC Company · due Oct 18</span></div><strong>72%</strong><div className="lp-project-progress"><i style={{ width: '72%' }} /></div></div>
        <div className="lp-project-card"><div><b>Brand launch campaign</b><span>Greenfield Stays · due Nov 02</span></div><strong>38%</strong><div className="lp-project-progress"><i style={{ width: '38%' }} /></div></div>
        <div className="lp-task-strip"><span>Today’s focus</span><b>Review homepage copy</b><span className="lp-task-due">Due today</span></div>
      </div>
    )
  }
  if (activeTab === 'team') {
    return (
      <div className="lp-chat-view">
        <div className="lp-chat-sidebar"><b>Channels</b><span className="selected"># general</span><span># marketing</span><span># operations</span><span># website-redesign</span></div>
        <div className="lp-chat-main"><div className="lp-preview-heading"><div><small>Team conversation</small><strong># general</strong></div><span className="lp-online">● 8 online</span></div>
          <div className="lp-chat-message"><i className="lp-avatar av-blue">SJ</i><p><b>Sarah Johnson</b><span>Creative review is ready. I’ve shared the latest assets in the project folder.</span><small>10:24</small></p></div>
          <div className="lp-chat-message"><i className="lp-avatar av-green">DA</i><p><b>David Adebayo</b><span>Perfect. I’ll leave feedback before our client call.</span><small>10:29</small></p></div>
          <div className="lp-chat-composer">Write a message… <span>↗</span></div>
        </div>
      </div>
    )
  }
  if (activeTab === 'vault') {
    return (
      <div className="lp-vault-view">
        <div className="lp-preview-heading"><div><small>Restricted workspace</small><strong>Document Vault</strong></div><span className="lp-lock">⌑ Protected</span></div>
        <div className="lp-vault-banner"><span className="lp-shield">✓</span><div><b>Access controlled by your organization</b><small>Only approved roles can open these records.</small></div></div>
        <div className="lp-vault-doc"><i className="lp-file-icon pdf">PDF</i><div><b>Certificate of incorporation</b><small>Business registration · Expires 12 Mar 2027</small></div><span>•••</span></div>
        <div className="lp-vault-doc"><i className="lp-file-icon doc">DOC</i><div><b>Company data policy</b><small>Policies · Updated 3 days ago</small></div><span>•••</span></div>
        <div className="lp-vault-doc"><i className="lp-file-icon pdf">PDF</i><div><b>Staff confidentiality agreement</b><small>People &amp; HR · Restricted</small></div><span>•••</span></div>
      </div>
    )
  }
  return (
    <div className="lp-dashboard-view">
      <div className="lp-preview-heading"><div><small>Good morning, Alex</small><strong>Here’s your workspace at a glance.</strong></div><span className="lp-date">Thursday, October 3</span></div>
      <div className="lp-stat-row"><div><span>Active projects</span><b>08</b><small>↗ 2 this month</small></div><div><span>Tasks to do</span><b>16</b><small>5 due this week</small></div><div><span>Clients</span><b>24</b><small>Across 6 industries</small></div><div><span>Team</span><b>12</b><small>4 online now</small></div></div>
      <div className="lp-dashboard-lower"><div className="lp-mini-panel"><b>Project activity</b><div className="lp-chart"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><small>Work moving forward, all in one view.</small></div><div className="lp-mini-panel"><b>Recent activity</b><p><i className="lp-avatar av-blue">SJ</i><span><strong>Sarah shared a file</strong><small>Brand guidelines.pdf · 12 min ago</small></span></p><p><i className="lp-avatar av-green">DA</i><span><strong>David completed a task</strong><small>Landing page review · 38 min ago</small></span></p></div></div>
    </div>
  )
}

function LandingPage({ onGetStarted, onLogin }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [year] = useState(() => new Date().getFullYear())
  const [plans, setPlans] = useState({})

  // Prices and limits are managed in the super-admin console; fall back to the copy below if the API is unreachable.
  useEffect(() => {
    fetch('/api/plans')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setPlans(Object.fromEntries(data.plans.map((plan) => [plan.name, plan]))))
      .catch(() => {})
  }, [])

  function price(name) {
    const plan = plans[name]
    if (!plan) return null
    return (
      <div className="lp-plan-price">
        {plan.monthlyPrice !== null ? <><strong>{formatPrice(plan.monthlyPrice, plan.currency)}</strong><span>/ month</span></> : <strong>Custom</strong>}
        {plan.yearlyPrice !== null && <small>or {formatPrice(plan.yearlyPrice, plan.currency)} billed yearly</small>}
      </div>
    )
  }

  function limits(name, fallbackMembers, fallbackStorage) {
    const plan = plans[name]
    const members = !plan ? fallbackMembers : plan.userLimit >= 2147483647 ? 'Unlimited members' : `Workspace for up to ${plan.userLimit} members`
    const storage = plan ? `${formatBytes(plan.storageLimitBytes)} storage` : fallbackStorage
    return <><div className="lp-plan-feature"><span>✓</span> {members}</div><div className="lp-plan-feature"><span>✓</span> {storage}</div></>
  }

  useEffect(() => {
    const targets = document.querySelectorAll('.lp-reveal')
    if (!('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('is-visible'))
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -36px 0px' })
    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [])

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <main className="landing-page">
      <header className="lp-nav">
        <a className="lp-brand" href="#top" onClick={closeMenu} aria-label="Workora home">
          <span className="lp-brand-symbol"><i /><i /><i /></span>
          <span>workora<small>BUSINESS WORKSPACE</small></span>
        </a>
        <button type="button" className="lp-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Toggle navigation">
          <span /><span />
        </button>
        <nav className={menuOpen ? 'lp-nav-links open' : 'lp-nav-links'}>
          <a href="#product" onClick={closeMenu}>Product</a>
          <a href="#features" onClick={closeMenu}>Features</a>
          <a href="#how-it-works" onClick={closeMenu}>How it works</a>
          <a href="#pricing" onClick={closeMenu}>Pricing</a>
          <a href="#about" onClick={closeMenu}>About</a>
          <div className="lp-mobile-actions">
            <button type="button" className="lp-login" onClick={() => { closeMenu(); onLogin() }}>Log in</button>
            <button type="button" className="lp-nav-cta" onClick={() => { closeMenu(); onGetStarted() }}>Get started <span>↗</span></button>
          </div>
        </nav>
        <div className="lp-desktop-actions">
          <button type="button" className="lp-login" onClick={onLogin}>Log in</button>
          <button type="button" className="lp-nav-cta" onClick={onGetStarted}>Get started <span>↗</span></button>
        </div>
      </header>

      <section className="lp-hero" id="top">
        <div className="lp-hero-grid">
          <div className="lp-hero-copy">
            <div className="lp-kicker"><span /> ONE WORKSPACE. BETTER WORK.</div>
            <h1>Bring your business<br />into <em>one orbit.</em></h1>
            <p className="lp-hero-lede">Projects, people, clients, files and conversations—finally working together in one calm, connected workspace.</p>
            <div className="lp-hero-actions">
              <button type="button" className="lp-primary-button" onClick={onGetStarted}>Create your workspace <span>↗</span></button>
              <a className="lp-secondary-button" href="#product"><span className="lp-play">▶</span> Explore the platform</a>
            </div>
            <div className="lp-trust-line"><div className="lp-avatar-stack"><i>MK</i><i>DA</i><i>SJ</i><i>+8</i></div><span>A clearer way for teams to move forward.</span></div>
          </div>
          <div className="lp-hero-art" aria-label="Illustration of connected business workspace">
            <div className="lp-orbit orbit-one" /><div className="lp-orbit orbit-two" />
            <div className="lp-orbit-core"><span className="lp-core-mark"><i /><i /><i /></span><b>WORKORA</b><small>YOUR BUSINESS, IN SYNC</small></div>
            <div className="lp-orbit-node node-files"><span>▤</span><b>Files</b><small>Everything in place</small></div>
            <div className="lp-orbit-node node-projects"><span>◫</span><b>Projects</b><small>Progress, together</small></div>
            <div className="lp-orbit-node node-team"><span>◌</span><b>Your team</b><small>One shared direction</small></div>
            <div className="lp-orbit-node node-clients"><span>◎</span><b>Clients</b><small>Every detail connected</small></div>
            <div className="lp-orbit-spark spark-a">✳</div><div className="lp-orbit-spark spark-b">✳</div>
          </div>
        </div>
        <div className="lp-hero-foot"><span>LESS TOOL-SWITCHING</span><i /><span>MORE MEANINGFUL WORK</span><i /><span>A HOME FOR YOUR WHOLE TEAM</span></div>
      </section>

      <section className="lp-intro lp-reveal" id="about">
        <div className="lp-section-label"><span>01</span> A BETTER WAY TO WORK</div>
        <div className="lp-intro-copy"><h2>Your business is one.<br /><em>Your tools should be, too.</em></h2><p>Workora brings the moving parts of your business into one private space. Less searching, fewer scattered conversations—more room to do your best work.</p></div>
      </section>

      <section className="lp-product-section" id="product">
        <div className="lp-product-head lp-reveal"><div><div className="lp-section-label"><span>02</span> A LOOK INSIDE</div><h2>One workspace.<br /><em>Every moving part.</em></h2></div><p>From the first client conversation to the final deliverable, see what matters and keep the whole team moving together.</p></div>
        <div className="lp-preview-shell lp-reveal">
          <div className="lp-preview-topbar"><div className="lp-window-dots"><i /><i /><i /></div><div className="lp-preview-url"><span>✳</span> acme-studio <i>›</i> workspace</div><div className="lp-preview-profile"><span>⌕</span><i>AJ</i></div></div>
          <div className="lp-preview-app">
            <aside className="lp-preview-sidebar"><div className="lp-preview-logo"><span className="lp-brand-symbol"><i /><i /><i /></span><b>workora</b></div><small>WORKSPACE</small><div className="lp-preview-nav active">◧ <span>Overview</span></div><div className="lp-preview-nav">▦ <span>Projects</span><b>8</b></div><div className="lp-preview-nav">✓ <span>My tasks</span><b>4</b></div><div className="lp-preview-nav">◎ <span>Clients</span></div><div className="lp-preview-nav">▤ <span>Files</span></div><div className="lp-preview-nav">◌ <span>Team chat</span><i className="lp-unread" /></div><div className="lp-preview-sidebar-bottom"><i>AJ</i><span><b>Alex Johnson</b><small>Workspace owner</small></span><span>•••</span></div></aside>
            <div className="lp-preview-content">
              <div className="lp-preview-tabs" role="tablist" aria-label="Interactive product preview">
                {previewTabs.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? 'active' : ''} key={tab.key} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}
              </div>
              <PreviewContent activeTab={activeTab} />
            </div>
          </div>
          <div className="lp-preview-caption"><span>ILLUSTRATIVE WORKSPACE PREVIEW · SAMPLE DATA</span><span>Choose a workspace view above ↗</span></div>
        </div>
      </section>

      <section className="lp-feature-story" id="features">
        <div className="lp-feature-main lp-reveal"><div className="lp-section-label"><span>03</span> BUILT FOR THE WAY YOU WORK</div><h2>Less admin in the way.<br /><em>More room to do great work.</em></h2><p>A connected toolkit for the real work behind every business—not another app that adds to your busywork.</p></div>
        <div className="lp-feature-list">
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">01</span><div className="lp-feature-icon icon-files">▤</div><div><h3>Your files, with their context.</h3><p>Organize company files and client deliverables in shared folders. Know what changed, who shared it and where it belongs.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">02</span><div className="lp-feature-icon icon-projects">◫</div><div><h3>Projects that keep moving.</h3><p>Bring owners, tasks, deadlines and project conversations together. Make the next step clear for everyone.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">03</span><div className="lp-feature-icon icon-clients">◎</div><div><h3>Clients, not loose ends.</h3><p>Keep client information and the work connected to each relationship, all within your team's workspace.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">04</span><div className="lp-feature-icon icon-vault">⌑</div><div><h3>Important records, protected.</h3><p>Keep essential company documents in a dedicated vault, separate from everyday working files.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">05</span><div className="lp-feature-icon icon-team">◌</div><div><h3>Your team, in the conversation.</h3><p>Give work a shared home with internal communication and the ability to see the context around decisions.</p></div><span className="lp-feature-arrow">↗</span></article>
        </div>
      </section>

      <section className="lp-workflow-section" id="how-it-works">
        <div className="lp-workflow-heading lp-reveal"><div className="lp-section-label"><span>04</span> SIMPLE BY DESIGN</div><h2>From scattered to <em>in sync.</em></h2><p>Start with the parts of Workora your team needs. Build a workspace around the way your business already works.</p></div>
        <div className="lp-steps">
          <article className="lp-step lp-reveal"><span>01</span><div className="lp-step-line"><i /></div><h3>Create your space</h3><p>Set up a private workspace for your business, with your organization at its center.</p></article>
          <article className="lp-step lp-reveal"><span>02</span><div className="lp-step-line"><i /></div><h3>Bring your team in</h3><p>Invite colleagues and give people access appropriate to their role and work.</p></article>
          <article className="lp-step lp-reveal"><span>03</span><div className="lp-step-line"><i /></div><h3>Get work moving</h3><p>Organize projects, manage clients and keep files and decisions close to the work.</p></article>
        </div>
      </section>

      <section className="lp-security-section">
        <div className="lp-security-visual lp-reveal"><div className="lp-security-ring ring-back" /><div className="lp-security-ring ring-front" /><div className="lp-security-center">⌑</div><div className="lp-security-chip chip-one"><span>✓</span> Private workspace</div><div className="lp-security-chip chip-two"><span>✓</span> Role-based access</div><div className="lp-security-chip chip-three"><span>✓</span> Tenant separation</div></div>
        <div className="lp-security-copy lp-reveal"><div className="lp-section-label"><span>05</span> PRIVATE BY DESIGN</div><h2>Your workspace.<br /><em>Your business only.</em></h2><p>Workora is built around separate company workspaces. Membership and role checks are enforced by the backend, so private business data is not exposed just because someone knows a link.</p><div className="lp-security-note"><span>⌑</span><p><b>Access belongs to your organization.</b><small>Keep your team's work private, organized and under your control.</small></p></div></div>
      </section>

      <section className="lp-pricing-section" id="pricing">
        <div className="lp-pricing-heading lp-reveal"><div className="lp-section-label"><span>06</span> ROOM TO GROW</div><h2>A workspace that grows<br />with <em>your business.</em></h2><p>Start with a private business workspace, then choose a plan that fits your team as you grow.</p></div>
        <div className="lp-plan-grid">
          <article className="lp-plan lp-reveal"><span className="lp-plan-label">A PLACE TO START</span><h3>Starter</h3><p>For small teams bringing their work together.</p>{price('Starter')}{limits('Starter', 'Workspace for up to 5 members', 'Up to 5 GB storage')}<div className="lp-plan-feature"><span>✓</span> Core projects and file organization</div><button type="button" onClick={onGetStarted}>Explore Starter <span>↗</span></button></article>
          <article className="lp-plan lp-plan-featured lp-reveal"><span className="lp-plan-label">FOR TEAMS IN MOTION</span><h3>Business</h3><p>More room and capabilities for growing teams.</p>{price('Business')}{limits('Business', 'Workspace for up to 25 members', 'Up to 50 GB storage')}<div className="lp-plan-feature"><span>✓</span> CRM, campaigns and Document Vault</div><button type="button" onClick={onGetStarted}>Explore Business <span>↗</span></button></article>
          <article className="lp-plan lp-reveal"><span className="lp-plan-label">BUILT AROUND YOU</span><h3>Enterprise</h3><p>Room for larger teams and advanced needs.</p>{price('Enterprise')}<div className="lp-plan-feature"><span>✓</span> Expanded team and storage limits</div><div className="lp-plan-feature"><span>✓</span> Advanced administration</div><div className="lp-plan-feature"><span>✓</span> Tailored workspace requirements</div><button type="button" onClick={onGetStarted}>Talk to our team <span>↗</span></button></article>
        </div>
        <p className="lp-pricing-footnote">Every workspace starts with a free 14-day Starter trial. No card needed to sign up; paid plans are invoiced and paid by bank transfer.</p>
      </section>

      <section className="lp-cta-section lp-reveal">
        <div className="lp-cta-orbit"><i /><i /><i /></div><div className="lp-cta-content"><div className="lp-section-label"><span>YOUR NEXT CHAPTER</span></div><h2>Ready to bring your<br />business into <em>one workspace?</em></h2><p>Create a space for your business, invite your team and give good work a place to happen.</p><button type="button" className="lp-primary-button" onClick={onGetStarted}>Create your business workspace <span>↗</span></button><small>No payment taken during sign-up.</small></div>
      </section>

      <footer className="lp-footer"><a className="lp-brand" href="#top"><span className="lp-brand-symbol"><i /><i /><i /></span><span>workora<small>BUSINESS WORKSPACE</small></span></a><p>One place for the work that moves you forward.</p><div className="lp-footer-links"><a href="#product">Product</a><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#pricing">Plans</a><button type="button" onClick={onLogin}>Log in</button><button type="button" onClick={onGetStarted}>Create workspace</button></div><div className="lp-footer-bottom"><span>© {year} Workora</span><span>Built for teams doing meaningful work.</span><a href="#top">Back to top ↑</a></div></footer>
    </main>
  )
}

export default LandingPage

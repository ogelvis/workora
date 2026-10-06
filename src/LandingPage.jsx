import { useEffect, useState } from 'react'
import './LandingPage.css'
import { BrandMark } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import { formatPrice } from './lib/format.js'
import { PLAN_DETAILS, includesList, planAmount } from './lib/plans.js'
import { INDUSTRIES, SHEET_TEMPLATES } from '../shared/industries.js'

const previewTabs = [
  { key: 'overview', label: 'Smart home' },
  { key: 'sheets', label: 'OVO Sheets' },
  { key: 'projects', label: 'Projects' },
  { key: 'files', label: 'Files' },
  { key: 'team', label: 'Messages' },
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
  if (activeTab === 'sheets') {
    const rows = [
      ['4 Bedroom Duplex', 'Lekki Phase 1', '₦80M', 'Available', 'violet'],
      ['Office Space, 3rd floor', 'Victoria Island', '₦250M', 'Under offer', 'amber'],
      ['Land, 600 sqm', 'Ibeju-Lekki', '₦15M', 'Sold', 'green'],
      ['2 Bedroom Flat', 'Yaba', '₦4.5M / yr', 'Let', 'blue'],
    ]
    return (
      <div className="lp-sheet-view">
        <div className="lp-preview-heading"><div><small>Real estate / Sheets</small><strong>Properties</strong></div><span className="lp-mini-action">+ New record</span></div>
        <div className="lp-sheet-tools"><span>⌕ Search</span><span>Filter</span><span>Sort</span><span>Group: Status</span><span className="lp-sheet-export">Export ↓</span></div>
        <div className="lp-sheet-table">
          <div className="lp-table-head"><span>Property</span><span>Location</span><span>Price</span><span>Status</span></div>
          {rows.map(([name, place, price, status, tone]) => <div key={name}><span>{name}</span><span>{place}</span><span>{price}</span><span><i className={`lp-chip tone-${tone}`}>{status}</i></span></div>)}
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
      <div className="lp-preview-heading"><div><small>Thursday, October 3</small><strong>Good morning, ABC Properties</strong></div><span className="lp-date">+ Create</span></div>
      <div className="lp-stat-row"><div><span>Properties</span><b>18</b><small>3 new this week</small></div><div><span>Active clients</span><b>24</b><small>7 follow-ups today</small></div><div><span>Deals</span><b>04</b><small>₦410M in pipeline</small></div><div><span>Tasks</span><b>12</b><small>5 due this week</small></div></div>
      <div className="lp-dashboard-lower"><div className="lp-mini-panel"><b>Project activity</b><div className="lp-chart"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><small>Work moving forward, all in one view.</small></div><div className="lp-mini-panel"><b>Recent activity</b><p><i className="lp-avatar av-blue">SJ</i><span><strong>Sarah shared a file</strong><small>Brand guidelines.pdf · 12 min ago</small></span></p><p><i className="lp-avatar av-green">DA</i><span><strong>David completed a task</strong><small>Landing page review · 38 min ago</small></span></p></div></div>
    </div>
  )
}

// Pick an industry, see the workspace OVO prepares for it.
function IndustryShowcase({ onGetStarted }) {
  const featured = ['real_estate', 'marketing', 'education', 'construction', 'logistics', 'healthcare', 'legal', 'retail', 'hospitality', 'technology', 'finance', 'nonprofit']
  const [active, setActive] = useState('real_estate')
  const industry = INDUSTRIES.find((item) => item.key === active)
  const core = { clients: industry.clientLabel || 'Clients', projects: 'Projects', tasks: 'Tasks', campaigns: 'Campaigns', calendar: 'Calendar' }
  return (
    <section className="lp-industries" id="industries">
      <div className="lp-industries-head lp-reveal">
        <div className="lp-section-label"><span>02</span> BUILT AROUND YOUR INDUSTRY</div>
        <h2>Same foundation.<br /><em>Your kind of workspace.</em></h2>
      </div>
      <div className="lp-industry-layout lp-reveal">
        <div className="lp-industry-chips" role="tablist" aria-label="Industries">
          {featured.map((key) => {
            const item = INDUSTRIES.find((entry) => entry.key === key)
            return (
              <button key={key} type="button" role="tab" aria-selected={active === key} className={`lp-industry-chip tone-${item.color}${active === key ? ' active' : ''}`} onClick={() => setActive(key)}>
                <span><Icon name={item.icon} size={16} /></span>{item.label}
              </button>
            )
          })}
        </div>
        <div className={`lp-industry-card tone-${industry.color}`}>
          <div className="lp-industry-card-head">
            <span className="lp-industry-badge"><Icon name={industry.icon} size={20} /></span>
            <div><small>A {industry.label.toLowerCase()} workspace on OVO</small><strong>Your sidebar</strong></div>
          </div>
          <div className="lp-industry-nav">
            {industry.modules.map((key) => (
              <div key={key} className={`lp-industry-module tone-${SHEET_TEMPLATES[key].color}`}>
                <span><Icon name={SHEET_TEMPLATES[key].icon} size={15} /></span>
                <div><b>{SHEET_TEMPLATES[key].name}</b><small>{SHEET_TEMPLATES[key].columns.slice(0, 4).map((column) => column.name).join(' · ')}</small></div>
              </div>
            ))}
          </div>
          <p className="lp-industry-core">Plus {industry.core.map((key) => core[key]).join(', ')}, Sheets, Files and Messages.</p>
          <button type="button" className="lp-primary-button" onClick={onGetStarted}>Start a {industry.label.split(' / ')[0].toLowerCase()} workspace <span>↗</span></button>
        </div>
      </div>
    </section>
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

  // Prices and limits come from the console; without them the cards still show what each plan is for.
  const loaded = Object.keys(plans).length > 0
  const planCards = Object.keys(PLAN_DETAILS).filter((name) => !loaded || plans[name]).map((name) => plans[name] || { name, missing: true })

  function planPrice(plan) {
    if (plan.missing) return null
    if (plan.monthlyPrice === null) return <div className="lp-plan-price"><strong>Custom</strong><small>Priced for your organisation</small></div>
    if (!plan.monthlyPrice) return <div className="lp-plan-price"><strong>₦0</strong><span>forever</span><small>No card needed</small></div>
    return (
      <div className="lp-plan-price">
        <strong>{formatPrice(plan.monthlyPrice, plan.currency)}</strong><span>/ month</span>
        <small>or {formatPrice(planAmount(plan, 'yearly', plan.includedUsers), plan.currency)} a year (2 months free)</small>
      </div>
    )
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
        <a className="lp-brand" href="#top" onClick={closeMenu} aria-label="OVO home">
          <BrandMark size={30} />
        </a>
        <button type="button" className="lp-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Toggle navigation">
          <span /><span />
        </button>
        <nav className={menuOpen ? 'lp-nav-links open' : 'lp-nav-links'}>
          <a href="#product" onClick={closeMenu}>Product</a>
          <a href="#industries" onClick={closeMenu}>Industries</a>
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
            <div className="lp-kicker"><span /> ONE VISION. ONE ORGANIZATION.</div>
            <h1>One platform for the way <em>your business</em> works.</h1>
            <p className="lp-hero-lede">OVO is the business operating platform that adapts to your industry. Properties or patients, students or shipments — your records, clients, projects, files and team in one beautiful workspace.</p>
            <div className="lp-hero-actions">
              <button type="button" className="lp-primary-button" onClick={onGetStarted}>Create your workspace <span>↗</span></button>
              <a className="lp-secondary-button" href="#product"><span className="lp-play">▶</span> Explore the platform</a>
            </div>
            <div className="lp-trust-line"><div className="lp-avatar-stack"><i>MK</i><i>DA</i><i>SJ</i><i>+8</i></div><span>Powerful underneath. Simple on the surface.</span></div>
          </div>
          <div className="lp-hero-art" aria-label="Illustration of connected business workspace">
            <div className="lp-orbit orbit-one" /><div className="lp-orbit orbit-two" />
            <div className="lp-orbit-core"><BrandMark size={44} /><small>ONE VISION. ONE ORGANIZATION.</small></div>
            <div className="lp-orbit-node node-files"><span>▦</span><b>Sheets</b><small>Records, your way</small></div>
            <div className="lp-orbit-node node-projects"><span>◫</span><b>Projects</b><small>Progress, together</small></div>
            <div className="lp-orbit-node node-team"><span>◌</span><b>Your team</b><small>Talk around the work</small></div>
            <div className="lp-orbit-node node-clients"><span>◎</span><b>Clients</b><small>Every detail connected</small></div>
            <div className="lp-orbit-spark spark-a">✳</div><div className="lp-orbit-spark spark-b">✳</div>
          </div>
        </div>
        <div className="lp-hero-foot"><span>SHAPED AROUND YOUR INDUSTRY</span><i /><span>SPREADSHEET-SIMPLE RECORDS</span><i /><span>ONE HOME FOR YOUR WHOLE TEAM</span></div>
      </section>

      <section className="lp-intro lp-reveal" id="about">
        <div className="lp-section-label"><span>01</span> A BETTER WAY TO WORK</div>
        <div className="lp-intro-copy"><h2>Every business is different.<br /><em>Your workspace should be, too.</em></h2><p>OVO isn’t one dashboard forced on everyone. Tell us what you do, and your workspace arrives with the modules, records and tools your industry runs on — then make it entirely your own.</p></div>
      </section>

      <IndustryShowcase onGetStarted={onGetStarted} />

      <section className="lp-product-section" id="product">
        <div className="lp-product-head lp-reveal"><div><div className="lp-section-label"><span>03</span> A LOOK INSIDE</div><h2>One platform.<br /><em>Every moving part.</em></h2></div><p>A smart home that shows what matters today, sheets that hold every record, and your team talking right beside the work.</p></div>
        <div className="lp-preview-shell lp-reveal">
          <div className="lp-preview-topbar"><div className="lp-window-dots"><i /><i /><i /></div><div className="lp-preview-url"><span>✳</span> abc-properties <i>›</i> home</div><div className="lp-preview-profile"><span>⌕</span><i>AJ</i></div></div>
          <div className="lp-preview-app">
            <aside className="lp-preview-sidebar"><div className="lp-preview-logo"><BrandMark size={20} /></div><small>REAL ESTATE</small><div className="lp-preview-nav active">◧ <span>Home</span></div><div className="lp-preview-nav">▥ <span>Properties</span><b>18</b></div><div className="lp-preview-nav">◎ <span>Clients</span><b>24</b></div><div className="lp-preview-nav">◈ <span>Deals</span><b>4</b></div><div className="lp-preview-nav">◷ <span>Follow-ups</span></div><div className="lp-preview-nav">◌ <span>Messages</span><i className="lp-unread" /></div><div className="lp-preview-sidebar-bottom"><i>AJ</i><span><b>Alex Johnson</b><small>Workspace owner</small></span><span>•••</span></div></aside>
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
        <div className="lp-feature-main lp-reveal"><div className="lp-section-label"><span>04</span> POWERFUL UNDERNEATH</div><h2>Enterprise power.<br /><em>Simple on the surface.</em></h2><p>Everything a growing organization needs to run, without the training manual. Start simple; go deeper whenever you’re ready.</p></div>
        <div className="lp-feature-list">
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">01</span><div className="lp-feature-icon icon-projects">▦</div><div><h3>OVO Sheets: spreadsheet + database.</h3><p>Build client databases, inventories, registers and more. Add columns, filter, sort, group, save views, import from Excel or CSV and export to Excel, CSV or PDF.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">02</span><div className="lp-feature-icon icon-clients">◎</div><div><h3>Records with a memory.</h3><p>Every record has its own timeline and discussion, so you always know who changed what — and talk about a property or client right where it lives.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">03</span><div className="lp-feature-icon icon-files">⌕</div><div><h3>Search everything. Create anything.</h3><p>One search box across records, clients, projects, people, files and messages. One Create button for whatever comes next.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">04</span><div className="lp-feature-icon icon-vault">⌑</div><div><h3>Documents, protected.</h3><p>Shared company files with exact storage limits, plus a private vault for contracts and certificates only owners and admins can open.</p></div><span className="lp-feature-arrow">↗</span></article>
          <article className="lp-feature-row lp-reveal"><span className="lp-feature-number">05</span><div className="lp-feature-icon icon-team">◌</div><div><h3>Your team, around the work.</h3><p>Channels, private messages and record discussions keep communication next to the work it’s about — not lost in another app.</p></div><span className="lp-feature-arrow">↗</span></article>
        </div>
      </section>

      <section className="lp-workflow-section" id="how-it-works">
        <div className="lp-workflow-heading lp-reveal"><div className="lp-section-label"><span>05</span> SIMPLE BY DESIGN</div><h2>From scattered to <em>in sync.</em></h2><p>Set up in minutes. OVO builds the first version of your workspace for you, and you shape it from there.</p></div>
        <div className="lp-steps">
          <article className="lp-step lp-reveal"><span>01</span><div className="lp-step-line"><i /></div><h3>Tell us what you do</h3><p>Choose your industry and OVO prepares the modules, sheets and dashboard your business needs.</p></article>
          <article className="lp-step lp-reveal"><span>02</span><div className="lp-step-line"><i /></div><h3>Bring your team in</h3><p>Invite colleagues and give people access appropriate to their role and work.</p></article>
          <article className="lp-step lp-reveal"><span>03</span><div className="lp-step-line"><i /></div><h3>Run your business</h3><p>Import your spreadsheets, track every record and keep files, tasks and decisions close to the work.</p></article>
        </div>
      </section>

      <section className="lp-security-section">
        <div className="lp-security-visual lp-reveal"><div className="lp-security-ring ring-back" /><div className="lp-security-ring ring-front" /><div className="lp-security-center">⌑</div><div className="lp-security-chip chip-one"><span>✓</span> Private workspace</div><div className="lp-security-chip chip-two"><span>✓</span> Role-based access</div><div className="lp-security-chip chip-three"><span>✓</span> Tenant separation</div></div>
        <div className="lp-security-copy lp-reveal"><div className="lp-section-label"><span>06</span> PRIVATE BY DESIGN</div><h2>Your workspace.<br /><em>Your business only.</em></h2><p>OVO is built around separate company workspaces. Membership and role checks are enforced by the backend, so private business data is not exposed just because someone knows a link.</p><div className="lp-security-note"><span>⌑</span><p><b>Access belongs to your organization.</b><small>Keep your team's work private, organized and under your control.</small></p></div></div>
      </section>

      <section className="lp-pricing-section" id="pricing">
        <div className="lp-pricing-heading lp-reveal"><div className="lp-section-label"><span>07</span> ROOM TO GROW</div><h2>A workspace that grows<br />with <em>your business.</em></h2><p>Start with a private business workspace, then choose a plan that fits your team as you grow.</p></div>
        <div className="lp-plan-grid">
          {planCards.map((plan) => {
            const details = PLAN_DETAILS[plan.name]
            return (
              <article key={plan.name} className={`lp-plan lp-reveal${plan.name === 'Business' ? ' lp-plan-featured' : ''}`}>
                <span className="lp-plan-label">{details.label.toUpperCase()}</span>
                <h3>{plan.name}</h3>
                <p>{details.tagline}</p>
                {planPrice(plan)}
                {(plan.missing ? details.highlights : includesList(plan)).map((item) => <div key={item} className="lp-plan-feature"><span>✓</span> {item}</div>)}
                <button type="button" onClick={onGetStarted}>{plan.name === 'Free' ? 'Start free' : plan.name === 'Enterprise' ? 'Talk to our team' : `Start with ${plan.name}`} <span>↗</span></button>
              </article>
            )
          })}
        </div>
        <p className="lp-pricing-footnote">Every workspace starts with a free 14-day Business trial, then moves to Free unless you choose a plan. No card needed to start. Pay monthly, every 3 months (save 5%), every 6 months (save 10%) or yearly (2 months free), by card, bank transfer or USSD.</p>
      </section>

      <section className="lp-cta-section lp-reveal">
        <div className="lp-cta-orbit"><i /><i /><i /></div><div className="lp-cta-content"><div className="lp-section-label"><span>YOUR NEXT CHAPTER</span></div><h2>One vision.<br /><em>One organization.</em></h2><p>Create your OVO workspace, choose your industry and invite your team. Your first modules are ready the moment you arrive.</p><button type="button" className="lp-primary-button" onClick={onGetStarted}>Create your OVO workspace <span>↗</span></button><small>No payment taken during sign-up.</small></div>
      </section>

      <footer className="lp-footer"><a className="lp-brand" href="#top" aria-label="OVO home"><BrandMark size={30} /></a><p>One Vision. One Organization. One platform for the way your business actually works.</p><div className="lp-footer-links"><a href="#product">Product</a><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#pricing">Plans</a><button type="button" onClick={onLogin}>Log in</button><button type="button" onClick={onGetStarted}>Create workspace</button></div><div className="lp-footer-bottom"><span>© {year} OVO</span><span>Built for organizations of every kind.</span><a href="/terms">Terms of Use</a><a href="/privacy">Privacy Policy</a><a href="#top">Back to top ↑</a></div></footer>
    </main>
  )
}

export default LandingPage

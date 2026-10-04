// OVO adapts each workspace to its industry. The core (people, tasks, files, chat,
// sheets) is the same everywhere; each industry adds ready-made module sheets and
// decides which core areas lead the sidebar. Shared by the API and the web app.

const opt = (labels, colors) => labels.map((label, index) => ({ label, color: colors[index % colors.length] }))
const STATUS = ['blue', 'amber', 'violet', 'green', 'rose', 'slate']

// Column helpers keep the templates readable.
const text = (name) => ({ name, type: 'text' })
const long = (name) => ({ name, type: 'longtext' })
const num = (name) => ({ name, type: 'number' })
const money = (name) => ({ name, type: 'currency' })
const date = (name) => ({ name, type: 'date' })
const pick = (name, labels, colors = STATUS) => ({ name, type: 'select', options: opt(labels, colors) })
const person = (name) => ({ name, type: 'person' })
const email = (name) => ({ name, type: 'email' })
const phone = (name) => ({ name, type: 'phone' })
const check = (name) => ({ name, type: 'checkbox' })
const link = (name) => ({ name, type: 'url' })

export const COLUMN_TYPES = [
  { type: 'text', label: 'Text', icon: 'text' },
  { type: 'longtext', label: 'Long text', icon: 'notes' },
  { type: 'number', label: 'Number', icon: 'hash' },
  { type: 'currency', label: 'Money', icon: 'money' },
  { type: 'date', label: 'Date', icon: 'calendar' },
  { type: 'select', label: 'Status / choice', icon: 'tag' },
  { type: 'person', label: 'Team member', icon: 'team' },
  { type: 'checkbox', label: 'Checkbox', icon: 'tasks' },
  { type: 'email', label: 'Email', icon: 'mail' },
  { type: 'phone', label: 'Phone', icon: 'phone' },
  { type: 'url', label: 'Link', icon: 'link' },
]

export const OPTION_COLORS = ['blue', 'green', 'amber', 'violet', 'rose', 'teal', 'orange', 'pink', 'sky', 'slate']

// Every template a workspace can start a sheet from. `key` is stable; never rename one.
export const SHEET_TEMPLATES = {
  properties: { name: 'Properties', icon: 'building', color: 'violet', description: 'Every listing with its price, status and agent.', columns: [
    text('Property'), pick('Type', ['Apartment', 'Duplex', 'Detached house', 'Terrace', 'Land', 'Commercial', 'Office'], ['violet', 'blue', 'teal', 'sky', 'amber', 'orange', 'slate']),
    text('Location'), money('Price'), pick('Status', ['Available', 'Under offer', 'Sold', 'Let', 'Off market'], ['green', 'amber', 'violet', 'blue', 'slate']),
    text('Owner'), person('Agent'), num('Bedrooms'), long('Notes'),
  ] },
  re_clients: { name: 'Buyers & Tenants', icon: 'clients', color: 'pink', description: 'People looking for a property and what they want.', columns: [
    text('Client'), phone('Phone'), email('Email'), text('Property interest'), money('Budget'), text('Location preference'), person('Agent'),
    pick('Status', ['New', 'Contacted', 'Interested', 'Viewing booked', 'Closed', 'Lost'], ['sky', 'blue', 'violet', 'amber', 'green', 'slate']),
    date('Follow-up'), long('Notes'),
  ] },
  deals: { name: 'Deals', icon: 'deal', color: 'green', description: 'Offers and sales moving towards close.', columns: [
    text('Deal'), text('Client'), text('Property'), money('Value'), person('Agent'),
    pick('Stage', ['Offer made', 'Negotiating', 'Documentation', 'Closed won', 'Closed lost'], ['blue', 'amber', 'violet', 'green', 'rose']),
    date('Expected close'),
  ] },
  follow_ups: { name: 'Follow-ups', icon: 'clock', color: 'amber', description: 'Calls, viewings and check-ins nobody should forget.', columns: [
    text('Follow-up'), text('Client'), date('Due'), person('Owner'), pick('Channel', ['Call', 'WhatsApp', 'Email', 'Viewing', 'Meeting'], ['blue', 'green', 'sky', 'violet', 'amber']),
    check('Done'), long('Notes'),
  ] },
  content_calendar: { name: 'Content Calendar', icon: 'calendar', color: 'pink', description: 'Posts and content across every channel.', columns: [
    text('Content'), text('Client'), pick('Channel', ['Instagram', 'TikTok', 'LinkedIn', 'X', 'Facebook', 'YouTube', 'Blog', 'Email'], ['pink', 'slate', 'blue', 'slate', 'sky', 'rose', 'amber', 'violet']),
    date('Publish date'), person('Owner'), pick('Status', ['Idea', 'Drafting', 'In review', 'Scheduled', 'Published'], ['slate', 'blue', 'amber', 'violet', 'green']),
    link('Link'),
  ] },
  reports: { name: 'Reports', icon: 'chart', color: 'sky', description: 'Client reports and their results.', columns: [
    text('Report'), text('Client'), date('Period end'), num('Reach'), num('Leads'), money('Spend'), pick('Status', ['Drafting', 'Sent', 'Approved'], ['amber', 'blue', 'green']),
  ] },
  students: { name: 'Students', icon: 'student', color: 'blue', description: 'Every student, their class and guardian.', columns: [
    text('Student'), text('Admission no.'), text('Class'), date('Date of birth'), text('Guardian'), phone('Guardian phone'),
    pick('Status', ['Active', 'Graduated', 'Withdrawn', 'Suspended'], ['green', 'violet', 'slate', 'rose']),
  ] },
  teachers: { name: 'Teachers', icon: 'team', color: 'violet', description: 'Teaching staff and what they teach.', columns: [
    text('Teacher'), text('Subject'), text('Class teacher of'), phone('Phone'), email('Email'), pick('Status', ['Full time', 'Part time', 'On leave'], ['green', 'blue', 'amber']),
  ] },
  classes: { name: 'Classes', icon: 'projects', color: 'teal', description: 'Classes, arms and their class teachers.', columns: [
    text('Class'), text('Arm'), person('Class teacher'), num('Students'), text('Room'),
  ] },
  attendance: { name: 'Attendance', icon: 'tasks', color: 'green', description: 'Daily attendance by student.', columns: [
    date('Date'), text('Student'), text('Class'), pick('Status', ['Present', 'Absent', 'Late', 'Excused'], ['green', 'rose', 'amber', 'sky']), long('Note'),
  ] },
  results: { name: 'Results', icon: 'chart', color: 'amber', description: 'Scores and grades by term.', columns: [
    text('Student'), text('Class'), text('Subject'), pick('Term', ['First term', 'Second term', 'Third term'], ['blue', 'violet', 'teal']), num('CA'), num('Exam'), num('Total'), text('Grade'),
  ] },
  fees: { name: 'Fees', icon: 'money', color: 'rose', description: 'School fees billed and paid.', columns: [
    text('Student'), text('Class'), pick('Term', ['First term', 'Second term', 'Third term'], ['blue', 'violet', 'teal']), money('Amount due'), money('Amount paid'),
    pick('Status', ['Unpaid', 'Part paid', 'Paid'], ['rose', 'amber', 'green']), date('Due date'),
  ] },
  sites: { name: 'Sites', icon: 'pin', color: 'orange', description: 'Every site, its manager and progress.', columns: [
    text('Site'), text('Location'), person('Site manager'), date('Start date'), date('Target completion'), num('Progress %'),
    pick('Status', ['Mobilising', 'In progress', 'Paused', 'Handed over'], ['sky', 'blue', 'amber', 'green']),
  ] },
  workers: { name: 'Workers', icon: 'team', color: 'blue', description: 'Crew, trades and day rates.', columns: [
    text('Name'), pick('Trade', ['Mason', 'Carpenter', 'Electrician', 'Plumber', 'Welder', 'Labourer', 'Engineer'], ['amber', 'orange', 'sky', 'blue', 'slate', 'teal', 'violet']),
    text('Site'), phone('Phone'), money('Day rate'), pick('Status', ['Active', 'Off site', 'Left'], ['green', 'amber', 'slate']),
  ] },
  materials: { name: 'Materials', icon: 'box', color: 'amber', description: 'Materials ordered, delivered and used.', columns: [
    text('Material'), text('Site'), num('Quantity'), text('Unit'), money('Unit cost'), text('Supplier'),
    pick('Status', ['Requested', 'Ordered', 'Delivered', 'Used'], ['slate', 'blue', 'green', 'violet']), date('Delivery date'),
  ] },
  contractors: { name: 'Contractors', icon: 'building', color: 'teal', description: 'Sub-contractors and their packages.', columns: [
    text('Contractor'), text('Package'), text('Contact'), phone('Phone'), money('Contract value'), pick('Status', ['Tendering', 'Engaged', 'Completed'], ['amber', 'blue', 'green']),
  ] },
  expenses: { name: 'Expenses', icon: 'money', color: 'rose', description: 'Spending by category, with receipts.', columns: [
    date('Date'), text('Item'), pick('Category', ['Materials', 'Labour', 'Transport', 'Fuel', 'Equipment', 'Office', 'Other'], ['amber', 'blue', 'teal', 'orange', 'violet', 'sky', 'slate']),
    money('Amount'), person('Spent by'), check('Receipt received'), long('Note'),
  ] },
  deliveries: { name: 'Deliveries', icon: 'truck', color: 'orange', description: 'Every delivery from pickup to drop-off.', columns: [
    text('Tracking no.'), text('Customer'), text('Pickup'), text('Drop-off'), text('Driver'), date('Date'),
    pick('Status', ['Pending', 'Picked up', 'In transit', 'Delivered', 'Failed'], ['slate', 'blue', 'amber', 'green', 'rose']), money('Fee'),
  ] },
  drivers: { name: 'Drivers', icon: 'team', color: 'blue', description: 'Drivers, licences and assigned vehicles.', columns: [
    text('Driver'), phone('Phone'), text('Licence no.'), date('Licence expiry'), text('Vehicle'), pick('Status', ['Available', 'On trip', 'Off duty'], ['green', 'amber', 'slate']),
  ] },
  vehicles: { name: 'Vehicles', icon: 'truck', color: 'teal', description: 'Fleet, servicing and papers.', columns: [
    text('Plate no.'), text('Model'), pick('Type', ['Bike', 'Car', 'Van', 'Truck'], ['sky', 'blue', 'violet', 'orange']), date('Next service'), date('Papers expiry'),
    pick('Status', ['Active', 'In repair', 'Retired'], ['green', 'amber', 'slate']),
  ] },
  routes: { name: 'Routes', icon: 'pin', color: 'violet', description: 'Regular routes and their costs.', columns: [
    text('Route'), text('From'), text('To'), num('Distance (km)'), money('Standard fee'),
  ] },
  patients: { name: 'Patients', icon: 'heart', color: 'rose', description: 'Patient register and next appointments.', columns: [
    text('Patient'), text('Hospital no.'), phone('Phone'), date('Date of birth'), person('Doctor'), date('Next appointment'),
    pick('Status', ['Outpatient', 'Admitted', 'Discharged', 'Referred'], ['blue', 'amber', 'green', 'violet']),
  ] },
  appointments: { name: 'Appointments', icon: 'calendar', color: 'sky', description: 'Bookings by doctor and time.', columns: [
    date('Date'), text('Time'), text('Patient'), person('Doctor'), pick('Type', ['Consultation', 'Follow-up', 'Test', 'Procedure'], ['blue', 'violet', 'teal', 'orange']),
    pick('Status', ['Booked', 'Arrived', 'Completed', 'Missed', 'Cancelled'], ['sky', 'amber', 'green', 'rose', 'slate']),
  ] },
  staff_roster: { name: 'Staff Roster', icon: 'team', color: 'violet', description: 'Who is on which shift.', columns: [
    date('Date'), person('Staff'), pick('Shift', ['Morning', 'Afternoon', 'Night'], ['amber', 'sky', 'violet']), text('Unit'),
  ] },
  inventory: { name: 'Inventory', icon: 'box', color: 'amber', description: 'Stock on hand and when to reorder.', columns: [
    text('Item'), text('SKU'), pick('Category', ['General', 'Raw material', 'Finished goods', 'Spare parts', 'Consumables'], ['slate', 'amber', 'green', 'blue', 'teal']),
    num('Quantity'), num('Reorder level'), money('Unit cost'), text('Location'),
  ] },
  cases: { name: 'Cases', icon: 'scale', color: 'indigo', description: 'Matters, courts and next hearing dates.', columns: [
    text('Case'), text('Client'), text('Court'), text('Suit no.'), person('Lead counsel'), date('Next hearing'),
    pick('Status', ['Intake', 'Active', 'Adjourned', 'Judgment', 'Closed'], ['sky', 'blue', 'amber', 'violet', 'slate']),
  ] },
  hearings: { name: 'Hearings', icon: 'calendar', color: 'amber', description: 'Court dates and outcomes.', columns: [
    date('Date'), text('Case'), text('Court'), person('Counsel'), long('Outcome'),
  ] },
  time_entries: { name: 'Time Entries', icon: 'clock', color: 'teal', description: 'Billable time by matter.', columns: [
    date('Date'), person('Who'), text('Client / matter'), num('Hours'), money('Rate'), check('Billable'), long('Work done'),
  ] },
  accounts: { name: 'Client Accounts', icon: 'money', color: 'green', description: 'Accounts, balances and risk.', columns: [
    text('Account'), text('Client'), money('Balance'), pick('Risk', ['Low', 'Medium', 'High'], ['green', 'amber', 'rose']), person('Relationship manager'), date('Next review'),
  ] },
  transactions: { name: 'Transactions', icon: 'money', color: 'blue', description: 'Money in and out.', columns: [
    date('Date'), text('Description'), text('Account'), pick('Type', ['Income', 'Expense', 'Transfer'], ['green', 'rose', 'blue']), money('Amount'), check('Reconciled'),
  ] },
  invoices: { name: 'Invoices', icon: 'billing', color: 'violet', description: 'Invoices sent and paid.', columns: [
    text('Invoice no.'), text('Client'), date('Issued'), date('Due'), money('Amount'), pick('Status', ['Draft', 'Sent', 'Part paid', 'Paid', 'Overdue'], ['slate', 'blue', 'amber', 'green', 'rose']),
  ] },
  reservations: { name: 'Reservations', icon: 'calendar', color: 'teal', description: 'Bookings, rooms and tables.', columns: [
    text('Guest'), phone('Phone'), date('Check-in'), date('Check-out'), text('Room / table'), num('Guests'), money('Amount'),
    pick('Status', ['Booked', 'Checked in', 'Checked out', 'Cancelled', 'No-show'], ['blue', 'green', 'violet', 'slate', 'rose']),
  ] },
  rooms: { name: 'Rooms', icon: 'building', color: 'violet', description: 'Rooms, rates and housekeeping.', columns: [
    text('Room'), pick('Type', ['Standard', 'Deluxe', 'Suite', 'Executive'], ['slate', 'blue', 'violet', 'amber']), money('Nightly rate'),
    pick('Status', ['Vacant clean', 'Vacant dirty', 'Occupied', 'Out of order'], ['green', 'amber', 'blue', 'rose']),
  ] },
  products: { name: 'Products', icon: 'box', color: 'pink', description: 'Your catalogue, prices and stock.', columns: [
    text('Product'), text('SKU'), pick('Category', ['General', 'New in', 'Best seller', 'Clearance'], ['slate', 'sky', 'green', 'rose']), money('Price'), num('In stock'), check('Online'),
  ] },
  orders: { name: 'Orders', icon: 'truck', color: 'blue', description: 'Customer orders from payment to delivery.', columns: [
    text('Order no.'), text('Customer'), date('Date'), money('Total'), pick('Payment', ['Pending', 'Paid', 'Refunded'], ['amber', 'green', 'slate']),
    pick('Status', ['New', 'Packed', 'Shipped', 'Delivered', 'Returned'], ['sky', 'blue', 'violet', 'green', 'rose']),
  ] },
  customers: { name: 'Customers', icon: 'clients', color: 'green', description: 'Customers and how much they buy.', columns: [
    text('Customer'), phone('Phone'), email('Email'), text('City'), money('Lifetime spend'), date('Last order'),
  ] },
  sales: { name: 'Sales Records', icon: 'chart', color: 'green', description: 'Daily sales by channel.', columns: [
    date('Date'), pick('Channel', ['Store', 'Online', 'WhatsApp', 'Wholesale'], ['blue', 'violet', 'green', 'amber']), money('Amount'), person('Recorded by'), long('Note'),
  ] },
  production: { name: 'Production', icon: 'factory', color: 'orange', description: 'Production runs and output.', columns: [
    text('Batch'), text('Product'), date('Date'), num('Planned qty'), num('Actual qty'), person('Supervisor'),
    pick('Status', ['Planned', 'Running', 'Completed', 'Halted'], ['slate', 'blue', 'green', 'rose']),
  ] },
  suppliers: { name: 'Suppliers', icon: 'building', color: 'teal', description: 'Supplier contacts and terms.', columns: [
    text('Supplier'), text('Supplies'), text('Contact'), phone('Phone'), email('Email'), pick('Rating', ['Preferred', 'Approved', 'On watch'], ['green', 'blue', 'amber']),
  ] },
  equipment: { name: 'Equipment', icon: 'settings', color: 'slate', description: 'Machines, servicing and condition.', columns: [
    text('Equipment'), text('Serial no.'), text('Location'), date('Last service'), date('Next service'),
    pick('Condition', ['Good', 'Needs attention', 'Out of service'], ['green', 'amber', 'rose']),
  ] },
  episodes: { name: 'Productions', icon: 'video', color: 'rose', description: 'Shows, shoots and release dates.', columns: [
    text('Title'), pick('Format', ['Video', 'Podcast', 'Article', 'Photo shoot'], ['rose', 'violet', 'blue', 'amber']), person('Producer'), date('Shoot date'), date('Release date'),
    pick('Status', ['Pitch', 'Pre-production', 'Shooting', 'Editing', 'Released'], ['slate', 'sky', 'amber', 'violet', 'green']),
  ] },
  sponsors: { name: 'Sponsors & Advertisers', icon: 'deal', color: 'amber', description: 'Deals with brands and their value.', columns: [
    text('Brand'), text('Contact'), money('Value'), date('Start'), date('End'), pick('Status', ['Pitching', 'Signed', 'Running', 'Completed'], ['sky', 'blue', 'violet', 'green']),
  ] },
  members: { name: 'Members', icon: 'team', color: 'violet', description: 'Members, departments and contacts.', columns: [
    text('Member'), phone('Phone'), email('Email'), text('Department / unit'), date('Joined'), pick('Status', ['Active', 'New', 'Inactive'], ['green', 'sky', 'slate']),
  ] },
  donations: { name: 'Giving & Donations', icon: 'heart', color: 'rose', description: 'Offerings, pledges and donations.', columns: [
    date('Date'), text('Donor'), pick('Type', ['Offering', 'Tithe', 'Pledge', 'Donation', 'Grant'], ['blue', 'violet', 'amber', 'green', 'teal']), money('Amount'), check('Acknowledged'),
  ] },
  events: { name: 'Programmes & Events', icon: 'calendar', color: 'amber', description: 'Programmes, venues and attendance.', columns: [
    text('Programme'), date('Date'), text('Venue'), person('Coordinator'), num('Expected'), num('Attended'),
  ] },
  volunteers: { name: 'Volunteers', icon: 'heart', color: 'teal', description: 'Volunteers and where they serve.', columns: [
    text('Volunteer'), phone('Phone'), text('Serves in'), pick('Availability', ['Weekdays', 'Weekends', 'Both'], ['blue', 'violet', 'green']),
  ] },
  leads: { name: 'Leads', icon: 'target', color: 'pink', description: 'Prospects and where they are in your pipeline.', columns: [
    text('Lead'), text('Company'), email('Email'), phone('Phone'), text('Source'), money('Potential value'), person('Owner'),
    pick('Stage', ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'], ['sky', 'blue', 'violet', 'amber', 'green', 'slate']),
  ] },
  products_tech: { name: 'Product Roadmap', icon: 'target', color: 'violet', description: 'Features from idea to release.', columns: [
    text('Feature'), pick('Area', ['Web', 'Mobile', 'API', 'Infrastructure'], ['blue', 'violet', 'teal', 'slate']), person('Owner'),
    pick('Status', ['Idea', 'Planned', 'Building', 'Testing', 'Released'], ['slate', 'sky', 'blue', 'amber', 'green']), date('Target date'),
  ] },
  bugs: { name: 'Issues', icon: 'alert', color: 'rose', description: 'Bugs and support issues.', columns: [
    text('Issue'), pick('Severity', ['Low', 'Medium', 'High', 'Critical'], ['slate', 'amber', 'orange', 'rose']), person('Assignee'), text('Reported by'),
    pick('Status', ['Open', 'In progress', 'Fixed', 'Closed'], ['rose', 'blue', 'green', 'slate']), date('Reported'),
  ] },
  employees: { name: 'Employee Register', icon: 'team', color: 'blue', description: 'Staff records in one place.', columns: [
    text('Employee'), text('Staff ID'), text('Department'), text('Role'), phone('Phone'), email('Email'), date('Start date'),
    pick('Status', ['Active', 'Probation', 'On leave', 'Exited'], ['green', 'sky', 'amber', 'slate']),
  ] },
  engagements: { name: 'Engagements', icon: 'deal', color: 'teal', description: 'Client engagements and fees.', columns: [
    text('Engagement'), text('Client'), person('Lead'), money('Fee'), date('Start'), date('End'), pick('Status', ['Proposal', 'Active', 'Completed'], ['amber', 'blue', 'green']),
  ] },
}

// What one record in each template is called ("Add property", not "Add propertie").
const ITEM_NAMES = {
  properties: 'Property', re_clients: 'Buyer or tenant', deals: 'Deal', follow_ups: 'Follow-up', content_calendar: 'Post', reports: 'Report',
  students: 'Student', teachers: 'Teacher', classes: 'Class', attendance: 'Attendance', results: 'Result', fees: 'Fee record', sites: 'Site',
  workers: 'Worker', materials: 'Material', contractors: 'Contractor', expenses: 'Expense', deliveries: 'Delivery', drivers: 'Driver',
  vehicles: 'Vehicle', routes: 'Route', patients: 'Patient', appointments: 'Appointment', staff_roster: 'Shift', inventory: 'Item',
  cases: 'Case', hearings: 'Hearing', time_entries: 'Time entry', accounts: 'Account', transactions: 'Transaction', invoices: 'Invoice',
  reservations: 'Reservation', rooms: 'Room', products: 'Product', orders: 'Order', customers: 'Customer', sales: 'Sale', production: 'Batch',
  suppliers: 'Supplier', equipment: 'Equipment', episodes: 'Production', sponsors: 'Sponsor', members: 'Member', donations: 'Donation',
  events: 'Programme', volunteers: 'Volunteer', leads: 'Lead', products_tech: 'Feature', bugs: 'Issue', employees: 'Employee', engagements: 'Engagement',
}

export function itemName(sheet) {
  if (ITEM_NAMES[sheet.templateKey]) return ITEM_NAMES[sheet.templateKey]
  const name = sheet.name.trim()
  if (/\s/.test(name)) return 'Record'
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y')
  if (/(ss|us)$/i.test(name)) return name
  return name.replace(/s$/i, '')
}

// `core` lists the built-in areas this industry leads with, in order.
// `modules` are template sheets created (and pinned to the sidebar) on sign-up.
export const INDUSTRIES = [
  { key: 'real_estate', label: 'Real Estate', icon: 'building', color: 'violet', modules: ['properties', 're_clients', 'deals', 'follow_ups'], core: ['clients', 'tasks', 'calendar'], clientLabel: 'Clients' },
  { key: 'marketing', label: 'Marketing Agency', icon: 'campaigns', color: 'pink', modules: ['content_calendar', 'reports', 'leads'], core: ['clients', 'campaigns', 'projects', 'tasks', 'calendar'] },
  { key: 'construction', label: 'Construction', icon: 'helmet', color: 'orange', modules: ['sites', 'workers', 'materials', 'contractors', 'expenses'], core: ['projects', 'tasks', 'clients', 'calendar'] },
  { key: 'logistics', label: 'Logistics', icon: 'truck', color: 'amber', modules: ['deliveries', 'drivers', 'vehicles', 'routes', 'expenses'], core: ['clients', 'tasks', 'calendar'], clientLabel: 'Customers' },
  { key: 'education', label: 'School / Education', icon: 'student', color: 'blue', modules: ['students', 'teachers', 'classes', 'attendance', 'results', 'fees'], core: ['tasks', 'calendar'] },
  { key: 'technology', label: 'Technology', icon: 'code', color: 'sky', modules: ['products_tech', 'bugs', 'leads'], core: ['projects', 'tasks', 'clients', 'calendar'] },
  { key: 'healthcare', label: 'Healthcare', icon: 'heart', color: 'rose', modules: ['patients', 'appointments', 'staff_roster', 'inventory'], core: ['tasks', 'calendar'] },
  { key: 'legal', label: 'Legal', icon: 'scale', color: 'indigo', modules: ['cases', 'hearings', 'time_entries', 'invoices'], core: ['clients', 'tasks', 'calendar'] },
  { key: 'finance', label: 'Finance', icon: 'money', color: 'green', modules: ['accounts', 'transactions', 'invoices', 'leads'], core: ['clients', 'tasks', 'calendar'] },
  { key: 'hospitality', label: 'Hospitality', icon: 'coffee', color: 'teal', modules: ['reservations', 'rooms', 'inventory', 'staff_roster'], core: ['campaigns', 'tasks', 'calendar'], clientLabel: 'Guests' },
  { key: 'retail', label: 'Retail', icon: 'bag', color: 'pink', modules: ['products', 'orders', 'customers', 'inventory', 'sales'], core: ['campaigns', 'tasks', 'calendar'] },
  { key: 'manufacturing', label: 'Manufacturing', icon: 'factory', color: 'orange', modules: ['production', 'inventory', 'suppliers', 'equipment', 'orders'], core: ['projects', 'tasks', 'clients', 'calendar'], clientLabel: 'Customers' },
  { key: 'media', label: 'Media', icon: 'video', color: 'rose', modules: ['episodes', 'content_calendar', 'sponsors'], core: ['projects', 'campaigns', 'tasks', 'clients', 'calendar'] },
  { key: 'nonprofit', label: 'Church / Nonprofit', icon: 'heart', color: 'violet', modules: ['members', 'donations', 'events', 'volunteers'], core: ['projects', 'tasks', 'calendar'] },
  { key: 'professional', label: 'Professional Services', icon: 'briefcase', color: 'teal', modules: ['engagements', 'time_entries', 'invoices', 'leads'], core: ['clients', 'projects', 'tasks', 'calendar'] },
  { key: 'other', label: 'Other', icon: 'overview', color: 'slate', modules: ['leads', 'employees'], core: ['clients', 'projects', 'tasks', 'campaigns', 'calendar'] },
]

// Organizations store the industry as typed text; match it back to a known industry.
export function findIndustry(value) {
  const needle = String(value || '').trim().toLowerCase()
  if (!needle) return null
  return INDUSTRIES.find((industry) => industry.key === needle || industry.label.toLowerCase() === needle) || null
}

export function industryFor(value) {
  return findIndustry(value) || INDUSTRIES[INDUSTRIES.length - 1]
}

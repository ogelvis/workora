DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_organization_id_id_key'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_organization_id_id_key UNIQUE (organization_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  campaign_type TEXT NOT NULL DEFAULT 'Other',
  objective TEXT NOT NULL DEFAULT '',
  target_audience TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Planning'
    CHECK (status IN ('Planning', 'Active', 'Review', 'Completed', 'Paused')),
  start_date DATE,
  end_date DATE,
  budget NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  platforms TEXT[] NOT NULL DEFAULT '{}',
  results TEXT NOT NULL DEFAULT '',
  leads_generated INTEGER NOT NULL DEFAULT 0 CHECK (leads_generated >= 0),
  conversions INTEGER NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  revenue NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE SET NULL (client_id)
);
CREATE INDEX IF NOT EXISTS campaigns_org_created_idx ON campaigns(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_org_status_idx ON campaigns(organization_id, status);

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'Meeting'
    CHECK (event_type IN ('Meeting', 'Task deadline', 'Project deadline', 'Campaign', 'Client appointment', 'Company event')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  project_id UUID,
  client_id UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE SET NULL (client_id)
);
CREATE INDEX IF NOT EXISTS calendar_events_org_start_idx ON calendar_events(organization_id, starts_at);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  resource_type TEXT,
  resource_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
  ON notifications(organization_id, user_id, created_at DESC);

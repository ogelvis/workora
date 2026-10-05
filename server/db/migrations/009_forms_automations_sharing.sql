-- Phase 2: forms that feed sheets, no-code automations, secure share links and sheet permissions.

-- Who can do what in a sheet. default applies to everyone; members override per person.
-- Levels: view < comment < edit < full. Owners, admins, managers and the creator always have full.
ALTER TABLE sheets ADD COLUMN IF NOT EXISTS access JSONB NOT NULL DEFAULT '{"default": "edit", "members": {}}'::jsonb;

-- Notifications can point anywhere in the app.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

CREATE TABLE IF NOT EXISTS forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  color TEXT NOT NULL DEFAULT 'violet',
  token TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  submit_message TEXT NOT NULL DEFAULT 'Thank you! Your response has been received.',
  notify BOOLEAN NOT NULL DEFAULT true,
  submission_count INTEGER NOT NULL DEFAULT 0,
  last_submission_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forms_org_idx ON forms(organization_id);

CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger JSONB NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automations_org_idx ON automations(organization_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_runs_idx ON automation_runs(automation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('sheet', 'record', 'file')),
  resource_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  view_id TEXT,
  allow_download BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_links_resource_idx ON share_links(organization_id, resource_type, resource_id);

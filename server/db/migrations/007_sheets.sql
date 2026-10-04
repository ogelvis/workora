-- OVO Sheets: business tables each workspace designs itself (and the industry modules).
CREATE TABLE IF NOT EXISTS sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'sheet',
  color TEXT NOT NULL DEFAULT 'violet',
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  views JSONB NOT NULL DEFAULT '[]'::jsonb,
  template_key TEXT NOT NULL DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sheets_org_idx ON sheets(organization_id, position);

CREATE TABLE IF NOT EXISTS sheet_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sheet_rows_sheet_idx ON sheet_rows(sheet_id, position);
CREATE INDEX IF NOT EXISTS sheet_rows_org_updated_idx ON sheet_rows(organization_id, updated_at DESC);

-- What happened to a record, newest first: the record's timeline.
CREATE TABLE IF NOT EXISTS sheet_row_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id UUID NOT NULL REFERENCES sheet_rows(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'updated', 'comment')),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sheet_row_events_row_idx ON sheet_row_events(row_id, created_at DESC);

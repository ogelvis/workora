-- Folders each business adds to Files or the Document Vault, on top of the built-in ones.
CREATE TABLE IF NOT EXISTS file_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vault BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS file_folders_unique_idx ON file_folders(organization_id, vault, lower(name));

-- Documents shared in team channels and direct messages.
CREATE TABLE IF NOT EXISTS chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id UUID,
  conversation_id UUID,
  message_id UUID,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  data BYTEA NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((channel_id IS NULL) <> (conversation_id IS NULL))
);
CREATE INDEX IF NOT EXISTS chat_attachments_channel_idx ON chat_attachments(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_attachments_conversation_idx ON chat_attachments(conversation_id, created_at DESC);

-- Task progress and the daily updates people post on their tasks.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100);
UPDATE tasks SET progress = 100 WHERE status = 'Completed' AND progress = 0;
CREATE TABLE IF NOT EXISTS task_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  progress INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_updates_task_idx ON task_updates(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_updates_org_day_idx ON task_updates(organization_id, created_at DESC);

-- OVO's own money in and out, recorded from the owner console (Paystack payments are counted automatically).
CREATE TABLE IF NOT EXISTS platform_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('inflow', 'outflow')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  category TEXT NOT NULL DEFAULT 'Other',
  description TEXT NOT NULL DEFAULT '',
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_ledger_day_idx ON platform_ledger(occurred_on DESC);

-- Each person's weekly report: what's done, what's pending, reasons for delays and what's remaining.
CREATE TABLE IF NOT EXISTS weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  done TEXT NOT NULL DEFAULT '',
  pending TEXT NOT NULL DEFAULT '',
  delays TEXT NOT NULL DEFAULT '',
  remaining TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, week_start)
);
CREATE INDEX IF NOT EXISTS weekly_reports_week_idx ON weekly_reports(organization_id, week_start DESC);

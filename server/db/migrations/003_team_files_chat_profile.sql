-- Company profile details
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry TEXT NOT NULL DEFAULT '';

-- Trials end 14 days after the workspace is created
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
UPDATE subscriptions SET trial_ends_at = created_at + interval '14 days' WHERE trial_ends_at IS NULL;
ALTER TABLE subscriptions ALTER COLUMN trial_ends_at SET DEFAULT now() + interval '14 days';

-- Projects can belong to a client
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_client_fk') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_client_fk
      FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE SET NULL (client_id);
  END IF;
END $$;

-- Team invitations, accepted through a single-use link
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  token_hash BYTEA NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_email_idx
  ON invitations(organization_id, email) WHERE accepted_at IS NULL;

-- Password reset links issued by a workspace owner or admin
CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Company files and the restricted document vault
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder TEXT NOT NULL DEFAULT 'Shared Files',
  vault BOOLEAN NOT NULL DEFAULT false,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  data BYTEA NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_org_vault_created_idx ON files(organization_id, vault, created_at DESC);

-- Team chat
CREATE TABLE IF NOT EXISTS chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  description TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, channel_id) REFERENCES chat_channels(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chat_messages_channel_created_idx ON chat_messages(channel_id, created_at DESC);

INSERT INTO chat_channels (organization_id, name, description)
SELECT id, 'general', 'Company-wide conversation' FROM organizations
ON CONFLICT (organization_id, name) DO NOTHING;

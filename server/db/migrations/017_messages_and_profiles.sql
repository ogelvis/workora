-- Announcements can go to chosen people or to everyone in one business, and can be direct messages.
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_category_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_category_check
  CHECK (category IN ('product', 'policy', 'security', 'service', 'message'));
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_audience_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_audience_check
  CHECK (audience IN ('everyone', 'admins', 'owners', 'people', 'workspace'));
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS recipient_ids UUID[];
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS announcements_recipients_idx ON announcements USING gin (recipient_ids);
CREATE INDEX IF NOT EXISTS announcements_org_idx ON announcements (organization_id);

-- Profile details people fill in themselves.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Profile pictures, kept small (resized in the browser) and apart from the users table.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  mime_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

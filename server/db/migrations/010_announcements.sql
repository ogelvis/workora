-- Product, policy, security and service announcements sent from the owner console.
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('product', 'policy', 'security', 'service')),
  audience TEXT NOT NULL CHECK (audience IN ('everyone', 'admins', 'owners')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 150),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 10000),
  cta_label TEXT,
  cta_url TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  emailed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_sent_idx ON announcements(sent_at DESC);

-- Product updates are optional; policy, security and service notices always reach everyone.
ALTER TABLE users ADD COLUMN IF NOT EXISTS product_updates BOOLEAN NOT NULL DEFAULT true;

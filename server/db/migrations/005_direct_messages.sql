-- Private one-to-one conversations between members of the same workspace.
-- user_a is always the smaller id so each pair has exactly one conversation.
CREATE TABLE IF NOT EXISTS direct_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_a_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_b_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  UNIQUE (organization_id, user_a, user_b)
);
CREATE INDEX IF NOT EXISTS direct_conversations_user_a_idx ON direct_conversations(organization_id, user_a);
CREATE INDEX IF NOT EXISTS direct_conversations_user_b_idx ON direct_conversations(organization_id, user_b);

CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS direct_messages_conversation_created_idx ON direct_messages(conversation_id, created_at DESC);

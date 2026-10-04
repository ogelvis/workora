-- Sessions started through the owner's private sign-in path carry platform-admin rights.
-- Sessions from the normal sign-in page never do, even for the same email.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS platform_admin BOOLEAN NOT NULL DEFAULT false;

-- src/db/migrations/003_schema_updates.sql

-- Add new columns to existing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_refresh_token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_user_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_token_expires_at TIMESTAMP WITH TIME ZONE;

-- Add columns to comments table
ALTER TABLE comments ADD COLUMN IF NOT EXISTS slack_message_ts VARCHAR(100);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES comments(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS comment_type VARCHAR(50);

-- Add any other columns you've added to other tables
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS github_connected BOOLEAN DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slack_connected BOOLEAN DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS admin_users UUID[] DEFAULT '{}'::UUID[];

-- Create new tables, if any
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  member_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create triggers for new tables
CREATE TRIGGER update_teams_timestamp BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Create indexes for new tables or columns
CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);

-- Add RLS for new tables
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Create policies for new tables
CREATE POLICY "Service role can do anything"
ON teams FOR ALL
TO service_role
USING (true);

-- CREATE POLICY "Organizations can only access their own teams"
ON teams FOR ALL
USING (org_id = auth.uid());
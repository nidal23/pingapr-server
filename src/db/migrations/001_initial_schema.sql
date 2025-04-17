-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create migrations table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create the execute_sql function for migrations
CREATE OR REPLACE FUNCTION execute_sql(sql_string TEXT)
RETURNS VOID AS $$
BEGIN
  EXECUTE sql_string;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the create_migrations_table function
CREATE OR REPLACE FUNCTION create_migrations_table()
RETURNS VOID AS $$
BEGIN
  CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Organizations table
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  github_org_id VARCHAR(100) NOT NULL UNIQUE,
  slack_workspace_id VARCHAR(100) NOT NULL,
  slack_bot_token VARCHAR(255) NOT NULL,
  github_installation_id VARCHAR(100) NOT NULL,
  settings JSONB NOT NULL DEFAULT '{"pr_reminder_hours": 24, "channel_archive_days": 7}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Repositories table
CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_repo_id VARCHAR(100) NOT NULL,
  github_repo_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(org_id, github_repo_id)
);

-- Create Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slack_user_id VARCHAR(100),
  github_username VARCHAR(100) NOT NULL,
  github_access_token VARCHAR(255),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(org_id, github_username),
  UNIQUE(org_id, slack_user_id)
);

-- Create PullRequests table
CREATE TABLE pull_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_pr_id VARCHAR(100) NOT NULL,
  github_pr_number INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open, closed, merged
  slack_channel_id VARCHAR(100),
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  merged_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(repo_id, github_pr_id)
);

-- Create ReviewRequests table
CREATE TABLE review_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, approved, changes_requested, commented
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(pr_id, reviewer_id)
);

-- Create Comments table
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pr_id UUID NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  github_comment_id VARCHAR(100) NOT NULL,
  slack_thread_ts VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(pr_id, github_comment_id)
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the updated_at trigger to all tables
CREATE TRIGGER update_organizations_timestamp BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_repositories_timestamp BEFORE UPDATE ON repositories FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_users_timestamp BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_pull_requests_timestamp BEFORE UPDATE ON pull_requests FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_review_requests_timestamp BEFORE UPDATE ON review_requests FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_comments_timestamp BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Create indexes for performance
CREATE INDEX idx_repositories_org_id ON repositories(org_id);
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_pull_requests_repo_id ON pull_requests(repo_id);
CREATE INDEX idx_pull_requests_author_id ON pull_requests(author_id);
CREATE INDEX idx_pull_requests_status ON pull_requests(status);
CREATE INDEX idx_review_requests_pr_id ON review_requests(pr_id);
CREATE INDEX idx_review_requests_reviewer_id ON review_requests(reviewer_id);
CREATE INDEX idx_comments_pr_id ON comments(pr_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);

-- Enable Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pull_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Create policies for multi-tenant security
-- Service role can bypass RLS
CREATE POLICY "Service role can do anything"
ON organizations FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role can do anything"
ON repositories FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role can do anything"
ON users FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role can do anything"
ON pull_requests FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role can do anything"
ON review_requests FOR ALL
TO service_role
USING (true);

CREATE POLICY "Service role can do anything"
ON comments FOR ALL
TO service_role
USING (true);

-- Create policies for authenticated org access
CREATE POLICY "Organizations can only access their own data" 
ON organizations FOR ALL 
USING (id = auth.uid());

CREATE POLICY "Organizations can only access their own repositories" 
ON repositories FOR ALL 
USING (org_id = auth.uid());

CREATE POLICY "Organizations can only access their own users" 
ON users FOR ALL 
USING (org_id = auth.uid());

CREATE POLICY "Organizations can only access their own pull requests" 
ON pull_requests FOR ALL 
USING (
  repo_id IN (SELECT id FROM repositories WHERE org_id = auth.uid())
);

CREATE POLICY "Organizations can only access their own review requests" 
ON review_requests FOR ALL 
USING (
  pr_id IN (SELECT pr.id FROM pull_requests pr 
    JOIN repositories repo ON pr.repo_id = repo.id 
    WHERE repo.org_id = auth.uid())
);

CREATE POLICY "Organizations can only access their own comments" 
ON comments FOR ALL 
USING (
  pr_id IN (SELECT pr.id FROM pull_requests pr 
    JOIN repositories repo ON pr.repo_id = repo.id 
    WHERE repo.org_id = auth.uid())
);

-- Create function to check for stale PRs
CREATE OR REPLACE FUNCTION check_stale_prs()
RETURNS TABLE (
  pr_id UUID,
  pr_title TEXT,
  pr_github_number INTEGER,
  slack_channel_id TEXT,
  org_id UUID,
  slack_bot_token TEXT,
  reminder_hours INTEGER,
  reviewers JSONB
) AS $$
DECLARE
  org RECORD;
  pr RECORD;
BEGIN
  -- Loop through all organizations
  FOR org IN SELECT o.id, o.slack_bot_token, (o.settings->'pr_reminder_hours')::INTEGER AS reminder_hours
             FROM organizations o
  LOOP
    -- For each organization, find stale PRs
    FOR pr IN SELECT 
                pr.id AS pr_id,
                pr.title AS pr_title,
                pr.github_pr_number AS pr_github_number,
                pr.slack_channel_id,
                pr.reminder_sent,
                r.org_id
              FROM pull_requests pr
              JOIN repositories r ON pr.repo_id = r.id
              WHERE r.org_id = org.id
                AND pr.status = 'open'
                AND pr.created_at < NOW() - (org.reminder_hours * INTERVAL '1 hour')
                AND (pr.reminder_sent = FALSE OR pr.reminder_sent IS NULL)
    LOOP
      -- For each stale PR, get its pending reviewers
      pr_id := pr.pr_id;
      pr_title := pr.pr_title;
      pr_github_number := pr.pr_github_number;
      slack_channel_id := pr.slack_channel_id;
      org_id := pr.org_id;
      slack_bot_token := org.slack_bot_token;
      reminder_hours := org.reminder_hours;
      
      -- Get pending reviewers
      reviewers := (
        SELECT json_agg(json_build_object(
          'reviewer_id', u.id,
          'slack_user_id', u.slack_user_id,
          'github_username', u.github_username
        ))
        FROM review_requests rr
        JOIN users u ON rr.reviewer_id = u.id
        WHERE rr.pr_id = pr.pr_id
          AND rr.status = 'pending'
      );
      
      -- If there are pending reviewers, return this row
      IF reviewers IS NOT NULL THEN
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to mark a PR as reminded
CREATE OR REPLACE FUNCTION mark_pr_reminded(pr_id_param UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE pull_requests
  SET reminder_sent = TRUE
  WHERE id = pr_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to archive old Slack channels for closed PRs
CREATE OR REPLACE FUNCTION check_channel_archival()
RETURNS TABLE (
  pr_id UUID,
  slack_channel_id TEXT,
  org_id UUID,
  slack_bot_token TEXT
) AS $$
DECLARE
  org RECORD;
  pr RECORD;
BEGIN
  -- Loop through all organizations
  FOR org IN SELECT o.id, o.slack_bot_token, (o.settings->'channel_archive_days')::INTEGER AS archive_days
             FROM organizations o
  LOOP
    -- For each organization, find PRs with closed channels ready for archiving
    FOR pr IN SELECT 
                pr.id AS pr_id,
                pr.slack_channel_id,
                r.org_id
              FROM pull_requests pr
              JOIN repositories r ON pr.repo_id = r.id
              WHERE r.org_id = org.id
                AND pr.status IN ('closed', 'merged')
                AND pr.closed_at < NOW() - (org.archive_days * INTERVAL '1 day')
                AND pr.slack_channel_id IS NOT NULL
    LOOP
      pr_id := pr.pr_id;
      slack_channel_id := pr.slack_channel_id;
      org_id := pr.org_id;
      slack_bot_token := org.slack_bot_token;
      
      RETURN NEXT;
    END LOOP;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
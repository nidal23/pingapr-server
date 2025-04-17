/**
 * Database seed script
 * Adds sample data for development/testing
 */
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../services/supabase/client');
const config = require('../config');

// Sample data
const seedData = {
  // Example organization
  organization: {
    id: uuidv4(),
    name: 'Acme Inc',
    github_org_id: 'sample-github-org-id',
    slack_workspace_id: 'sample-slack-workspace-id',
    slack_bot_token: 'xoxb-sample-slack-token',
    github_installation_id: 'sample-github-installation-id',
    settings: {
      pr_reminder_hours: config.defaults.prReminderHours,
      channel_archive_days: config.defaults.channelArchiveDays
    }
  },
  
  // Example repositories
  repositories: [
    {
      id: uuidv4(),
      github_repo_id: 'sample-repo-1',
      github_repo_name: 'acme/frontend',
      is_active: true
    },
    {
      id: uuidv4(),
      github_repo_id: 'sample-repo-2',
      github_repo_name: 'acme/backend',
      is_active: true
    }
  ],
  
  // Example users
  users: [
    {
      id: uuidv4(),
      github_username: 'johndoe',
      slack_user_id: 'U12345678',
      is_admin: true
    },
    {
      id: uuidv4(),
      github_username: 'janedoe',
      slack_user_id: 'U87654321',
      is_admin: false
    }
  ],
  
  // Example pull request
  pullRequests: [
    {
      id: uuidv4(),
      github_pr_id: 'sample-pr-1',
      github_pr_number: 123,
      title: 'Add new feature',
      description: 'This PR adds a new feature to the application',
      status: 'open',
      slack_channel_id: 'C12345678',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
};

// Function to seed the database
const seedDatabase = async () => {
  console.log('Starting database seed...');
  
  try {
    // Insert organization
    console.log('Adding organization...');
    const { error: orgError } = await supabase
      .from('organizations')
      .insert(seedData.organization);
    
    if (orgError) throw orgError;
    
    // Insert repositories
    console.log('Adding repositories...');
    const repositories = seedData.repositories.map(repo => ({
      ...repo,
      org_id: seedData.organization.id
    }));
    
    const { error: repoError } = await supabase
      .from('repositories')
      .insert(repositories);
    
    if (repoError) throw repoError;
    
    // Insert users
    console.log('Adding users...');
    const users = seedData.users.map(user => ({
      ...user,
      org_id: seedData.organization.id
    }));
    
    const { error: userError } = await supabase
      .from('users')
      .insert(users);
    
    if (userError) throw userError;
    
    // Insert pull request
    console.log('Adding pull request...');
    const pullRequests = seedData.pullRequests.map(pr => ({
      ...pr,
      repo_id: repositories[0].id,
      author_id: users[0].id
    }));
    
    const { error: prError } = await supabase
      .from('pull_requests')
      .insert(pullRequests);
    
    if (prError) throw prError;
    
    // Add review request
    console.log('Adding review request...');
    const { error: reviewError } = await supabase
      .from('review_requests')
      .insert({
        id: uuidv4(),
        pr_id: pullRequests[0].id,
        reviewer_id: users[1].id,
        status: 'pending',
        requested_at: new Date().toISOString()
      });
    
    if (reviewError) throw reviewError;
    
    console.log('Seed completed successfully.');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
};

// Run seed if this is the main module
if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}

module.exports = {
  seedDatabase
};
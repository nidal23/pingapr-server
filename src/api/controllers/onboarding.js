// src/api/controllers/onboarding.js
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../services/supabase/client');
const { ApiError } = require('../../middleware/error');

// Get current onboarding status
const getStatus = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    
    // Check GitHub connection
    const { data: githubConnection } = await supabase
      .from('github_connections')
      .select('is_connected')
      .eq('org_id', orgId)
      .single();
    
    // Check Slack connection
    const { data: slackConnection } = await supabase
      .from('slack_connections')
      .select('is_connected')
      .eq('org_id', orgId)
      .single();
    
    // Get active repositories
    const { data: repositories } = await supabase
      .from('repositories')
      .select('github_repo_id')
      .eq('org_id', orgId)
      .eq('is_active', true);
    
    // Get user mappings
    const { data: users } = await supabase
      .from('users')
      .select('github_username, slack_user_id, is_admin')
      .eq('org_id', orgId)
      .not('github_username', 'eq', 'pending');
    
    // Get organization settings
    const { data: org } = await supabase
      .from('organizations')
      .select('settings, onboarding_completed')
      .eq('id', orgId)
      .single();
    
    res.json({
      githubConnected: !!githubConnection?.is_connected,
      slackConnected: !!slackConnection?.is_connected,
      activeRepositories: repositories?.map(repo => repo.github_repo_id) || [],
      userMappings: users?.map(user => ({
        githubUsername: user.github_username,
        slackUserId: user.slack_user_id,
        isAdmin: user.is_admin
      })) || [],
      settings: org?.settings || {
        prReminderHours: 24,
        channelArchiveDays: 7
      },
      onboardingCompleted: !!org?.onboarding_completed
    });
  } catch (error) {
    next(error);
  }
};

// Save user mappings
const saveUserMappings = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const { mappings } = req.body;
    
    if (!mappings || !Array.isArray(mappings)) {
      throw new ApiError(400, 'Invalid mappings format');
    }
    
    // Get existing users for this organization
    const { data: existingUsers } = await supabase
      .from('users')
      .select('id, github_username, slack_user_id, is_admin')
      .eq('org_id', orgId);
    
    // Create maps for lookup
    const existingUsersByGithub = new Map();
    const existingUsersBySlack = new Map();
    
    existingUsers.forEach(user => {
      if (user.github_username) {
        existingUsersByGithub.set(user.github_username, user);
      }
      if (user.slack_user_id) {
        existingUsersBySlack.set(user.slack_user_id, user);
      }
    });
    
    // Process mappings individually to avoid unique constraint violations
    const updatedUsers = [];
    const errors = [];
    
    // Process each mapping one by one
    for (const mapping of mappings) {
      try {
        const existingUserByGithub = existingUsersByGithub.get(mapping.githubUsername);
        const existingUserBySlack = existingUsersBySlack.get(mapping.slackUserId);
        
        // Case 1: User exists by GitHub username
        if (existingUserByGithub) {
          // Update the Slack ID for this user (unless it's already mapped to someone else)
          if (existingUserBySlack && existingUserBySlack.id !== existingUserByGithub.id) {
            // Clear the Slack ID from the other user to avoid conflict
            await supabase
              .from('users')
              .update({ slack_user_id: null })
              .eq('id', existingUserBySlack.id);
          }
          
          // Update the GitHub user with Slack ID
          const { data, error } = await supabase
            .from('users')
            .update({
              slack_user_id: mapping.slackUserId,
              is_admin: !!mapping.isAdmin
            })
            .eq('id', existingUserByGithub.id)
            .select();
            
          if (error) throw error;
          if (data && data.length > 0) updatedUsers.push(data[0]);
        }
        // Case 2: Slack ID exists but GitHub username doesn't
        else if (existingUserBySlack) {
          // Update the user with the GitHub username
          const { data, error } = await supabase
            .from('users')
            .update({
              github_username: mapping.githubUsername,
              is_admin: !!mapping.isAdmin
            })
            .eq('id', existingUserBySlack.id)
            .select();
            
          if (error) throw error;
          if (data && data.length > 0) updatedUsers.push(data[0]);
        }
        // Case 3: New user entirely
        else {
          const { data, error } = await supabase
            .from('users')
            .insert({
              id: uuidv4(),
              org_id: orgId,
              github_username: mapping.githubUsername,
              slack_user_id: mapping.slackUserId,
              is_admin: !!mapping.isAdmin
            })
            .select();
            
          if (error) throw error;
          if (data && data.length > 0) updatedUsers.push(data[0]);
        }
      } catch (error) {
        // Log error but continue processing other mappings
        console.error(`Error processing mapping for ${mapping.githubUsername}:`, error);
        errors.push({
          githubUsername: mapping.githubUsername,
          slackUserId: mapping.slackUserId,
          error: error.message
        });
      }
    }
    
    // Update admin_users array in organization
    const adminUserIds = updatedUsers.filter(user => user.is_admin).map(user => user.id);
    
    // Add existing admins who aren't in the current mappings
    existingUsers.forEach(user => {
      if (user.is_admin && 
          !adminUserIds.includes(user.id) && 
          !updatedUsers.some(updatedUser => updatedUser.id === user.id)) {
        adminUserIds.push(user.id);
      }
    });
    
    await supabase
      .from('organizations')
      .update({
        admin_users: adminUserIds
      })
      .eq('id', orgId);
    
    res.json({
      success: true,
      users: updatedUsers,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    next(error);
  }
};

// Complete onboarding
const completeOnboarding = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const { settings } = req.body || {};
    
    // Update organization
    await supabase
      .from('organizations')
      .update({
        settings: settings || { 
          prReminderHours: 24, 
          channelArchiveDays: 7 
        },
        onboarding_completed: true
      })
      .eq('id', orgId);
    
    res.json({
      success: true,
      message: 'Onboarding completed'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStatus,
  saveUserMappings,
  completeOnboarding
};
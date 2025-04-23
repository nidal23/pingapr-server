// src/api/controllers/onboarding.js
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../../services/supabase/client');
const { ApiError } = require('../../middleware/error');

// Get current onboarding status
const getStatus = async (req, res, next) => {
    try {
      const orgId = req.organization.id;
      
      // Get organization details with connection status
      const { data: org } = await supabase
        .from('organizations')
        .select('github_connected, slack_connected, settings, onboarding_completed')
        .eq('id', orgId)
        .single();
      
      if (!org) {
        throw new ApiError(404, 'Organization not found');
      }
      
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
        .not('github_username', 'like', 'pending_%');
      
      res.json({
        githubConnected: !!org.github_connected,
        slackConnected: !!org.slack_connected,
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
    
    // Clear existing non-admin users for this organization
    await supabase
      .from('users')
      .delete()
      .eq('org_id', orgId)
      .eq('is_admin', false);
    
    // Create array of user objects for insert
    const usersToCreate = mappings.map(mapping => ({
      id: uuidv4(),
      org_id: orgId,
      github_username: mapping.githubUsername,
      slack_user_id: mapping.slackUserId,
      is_admin: !!mapping.isAdmin
    }));
    
    // Insert all users
    const { data, error } = await supabase
      .from('users')
      .insert(usersToCreate)
      .select();
    
    if (error) {
      throw error;
    }
    
    // Update admin_users array in organization
    const adminUsers = data.filter(user => user.is_admin).map(user => user.id);
    
    // Get existing admin (the current user)
    const { data: existingAdmin } = await supabase
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_admin', true)
      .limit(1)
      .single();
    
    if (existingAdmin && !adminUsers.includes(existingAdmin.id)) {
      adminUsers.push(existingAdmin.id);
    }
    
    await supabase
      .from('organizations')
      .update({
        admin_users: adminUsers
      })
      .eq('id', orgId);
    
    res.json({
      success: true,
      users: data
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
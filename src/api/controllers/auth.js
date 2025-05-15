// src/api/controllers/auth.js
const { ApiError } = require('../../middleware/error');
const authService = require('../../services/auth');
const { supabase } = require('../../services/supabase/client')
// Register new user
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      throw new ApiError(400, 'Name, email, and password are required');
    }
    
    const { user, token } = await authService.register(name, email, password);
    
    res.status(201).json({
      message: 'User registered successfully',
      user,
      token
    });
  } catch (error) {
    next(error);
  }
};

// Login existing user
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      throw new ApiError(400, 'Email and password are required');
    }
    
    const { user, token } = await authService.login(email, password);
    
    res.json({
      message: 'Login successful',
      user,
      token
    });
  } catch (error) {
    next(error);
  }
};

// Get current user
const getCurrentUser = async (req, res, next) => {
  try {
    // Return the user data from the JWT
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();
      
    res.json(data);
  } catch (error) {
    next(error);
  }
};


const updateUserIdentities = async (req, res, next) => {
  try {
    const { githubUsername, slackUserId } = req.body;
    
    if (!githubUsername || !slackUserId) {
      return res.status(400).json({ error: 'GitHub username and Slack user ID are required' });
    }
    
    const userId = req.user.id;
    const orgId = req.user.org_id;
    
    // Begin by checking for conflicts - fixed SQL injection by using separate queries
    // Check for GitHub username conflicts
    const { data: githubConflicts, error: githubError } = await supabase
      .from('users')
      .select('id, github_username')
      .eq('org_id', orgId)
      .eq('github_username', githubUsername)
      .neq('id', userId);
    
    // Check for Slack user ID conflicts
    const { data: slackConflicts, error: slackError } = await supabase
      .from('users')
      .select('id, slack_user_id')
      .eq('org_id', orgId)
      .eq('slack_user_id', slackUserId)
      .neq('id', userId);
    
    if (githubError || slackError) {
      const errorMsg = 'Failed to check for identity conflicts';
      console.error(errorMsg, { 
        githubError: githubError?.message,
        slackError: slackError?.message,
        userId,
        orgId
      });
      return res.status(500).json({ error: errorMsg });
    }
    
    // Handle any conflicts we found
    if (githubConflicts && githubConflicts.length > 0) {
      return res.status(409).json({ 
        error: 'This GitHub username is already linked to another user in your organization'
      });
    }
    
    if (slackConflicts && slackConflicts.length > 0) {
      return res.status(409).json({ 
        error: 'This Slack account is already linked to another user in your organization'
      });
    }
    
    // If no conflicts, proceed with the update
    const { data, error } = await supabase
      .from('users')
      .update({
        github_username: githubUsername,
        slack_user_id: slackUserId,
        is_admin: true // Set as admin since this is the person doing the onboarding
      })
      .eq('id', userId)
      .select()
      .single();
      
    if (error) {
      console.error('Error updating user identities:', {
        error: error.message,
        userId,
        orgId
      });
      return res.status(500).json({ error: 'Failed to update user identities' });
    }
      
    // Success - return the updated user data
    res.json(data);
  } catch (error) {
    // Safe error logging without exposing full error details
    console.error('Exception in updateUserIdentities:', {
      message: error.message,
      userId: req.user?.id,
      orgId: req.user?.org_id
    });
    next(error);
  }
};

module.exports = {
  register,
  login,
  getCurrentUser,
  updateUserIdentities
};
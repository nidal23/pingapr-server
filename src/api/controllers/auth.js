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

// src/api/controllers/auth.js - Update the updateUserIdentities function

const updateUserIdentities = async (req, res, next) => {
  try {
    const { githubUsername, slackUserId } = req.body;
    
    if (!githubUsername || !slackUserId) {
      return res.status(400).json({ error: 'GitHub username and Slack user ID are required' });
    }
    
    const userId = req.user.id;
    const orgId = req.user.org_id;
    
    // Begin by checking for conflicts
    const { data: conflicts, error: conflictError } = await supabase
      .from('users')
      .select('id, github_username, slack_user_id')
      .eq('org_id', orgId)
      .neq('id', userId)
      .or(`github_username.eq.${githubUsername},slack_user_id.eq.${slackUserId}`);
    
    if (conflictError) {
      console.error('Error checking for conflicts:', conflictError);
      return res.status(500).json({ error: 'Failed to check for identity conflicts' });
    }
    
    // Handle any conflicts we found
    const githubConflict = conflicts.find(u => u.github_username === githubUsername);
    const slackConflict = conflicts.find(u => u.slack_user_id === slackUserId);
    
    if (githubConflict) {
      return res.status(409).json({ 
        error: 'This GitHub username is already linked to another user in your organization'
      });
    }
    
    if (slackConflict) {
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
      console.error('Error updating user identities:', error);
      return res.status(500).json({ error: error.message });
    }
      
    res.json(data);
  } catch (error) {
    console.error('Exception in updateUserIdentities:', error);
    next(error);
  }
};

module.exports = {
  register,
  login,
  getCurrentUser,
  updateUserIdentities
};
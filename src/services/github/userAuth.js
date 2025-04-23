// src/services/github/userAuth.js
const axios = require('axios');
const { supabase } = require('../supabase/client');
const config = require('../../config');

const githubUserAuth = {
  /**
   * Generate GitHub OAuth URL for a specific user using GitHub App user authorization
   * @param {string} userId - User ID
   * @returns {Promise<string>} - Auth URL
   */
  async getAuthUrl(userId) {
    try {
      // Get user details to find their organization
      const { data: user, error } = await supabase
        .from('users')
        .select('org_id')
        .eq('id', userId)
        .single();
      
      if (error) {
        throw error;
      }
      
      // Create state parameter with user ID and org ID
      const state = Buffer.from(JSON.stringify({
        userId,
        orgId: user.org_id
      })).toString('base64');
      
      // Use the web application flow to get user access token
      // This is GitHub's recommended approach for GitHub Apps
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.append('client_id', config.github.clientId);
      url.searchParams.append('redirect_uri', `${process.env.GITHUB_USER_REDIRECT_URI}`);
      url.searchParams.append('state', state);
      
      // No scopes needed for GitHub App user access tokens
      // The token will inherit permissions from the GitHub App installation
      
      return url.toString();
    } catch (error) {
      console.error('Error generating GitHub auth URL for user:', error);
      throw error;
    }
  },
  
  /**
   * Handle OAuth callback for user authorization
   * @param {string} code - OAuth code
   * @param {string} state - State parameter
   * @returns {Promise<Object>} - Result
   */
  async handleCallback(code, state) {
    try {
      // Decode state
      const { userId, orgId } = JSON.parse(Buffer.from(state, 'base64').toString());
      
      // Exchange code for token using GitHub's OAuth endpoint
      const response = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
        redirect_uri: process.env.GITHUB_USER_REDIRECT_URI
      }, {
        headers: {
          Accept: 'application/json'
        }
      });
      
      // Check if we got a user access token
      if (!response.data.access_token) {
        throw new Error('Failed to get access token from GitHub');
      }
      
      const accessToken = response.data.access_token;
      
      // Get user info from GitHub to verify the token works
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      
      const githubUser = userResponse.data;
      
      // Update user record with the token
      await supabase
        .from('users')
        .update({
          github_access_token: accessToken,
          // Store token expiration if provided
          github_token_expires_at: response.data.expires_in ? 
            new Date(Date.now() + response.data.expires_in * 1000).toISOString() : 
            null,
          // Store refresh token if provided
          github_refresh_token: response.data.refresh_token || null,
          github_refresh_token_expires_at: response.data.refresh_token_expires_in ?
            new Date(Date.now() + response.data.refresh_token_expires_in * 1000).toISOString() :
            null
        })
        .eq('id', userId);
      
      // Send confirmation message via Slack
      await this.sendSlackConfirmation(userId, githubUser.login);
      
      return { 
        success: true,
        userId,
        githubUsername: githubUser.login
      };
    } catch (error) {
      console.error('Error handling GitHub user auth callback:', error);
      throw error;
    }
  },
  
  /**
   * Refresh a user's GitHub access token
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Success status
   */
  async refreshUserToken(userId) {
    try {
      // Get user details with refresh token
      const { data: user, error } = await supabase
        .from('users')
        .select('github_refresh_token')
        .eq('id', userId)
        .single();
      
      if (error || !user.github_refresh_token) {
        throw new Error('No refresh token available');
      }
      
      // Exchange refresh token for new access token
      const response = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: user.github_refresh_token
      }, {
        headers: {
          Accept: 'application/json'
        }
      });
      
      if (!response.data.access_token) {
        throw new Error('Failed to refresh access token');
      }
      
      // Update user with new tokens
      await supabase
        .from('users')
        .update({
          github_access_token: response.data.access_token,
          github_token_expires_at: response.data.expires_in ? 
            new Date(Date.now() + response.data.expires_in * 1000).toISOString() : 
            null,
          github_refresh_token: response.data.refresh_token || user.github_refresh_token,
          github_refresh_token_expires_at: response.data.refresh_token_expires_in ?
            new Date(Date.now() + response.data.refresh_token_expires_in * 1000).toISOString() :
            null
        })
        .eq('id', userId);
      
      return true;
    } catch (error) {
      console.error('Error refreshing user token:', error);
      return false;
    }
  },
  
  /**
   * Send confirmation message via Slack
   * @param {string} userId - User ID
   * @param {string} githubUsername - GitHub username
   * @returns {Promise<boolean>} - Success status
   */
  async sendSlackConfirmation(userId, githubUsername) {
    try {
      // Get user details
      const { data: user, error } = await supabase
        .from('users')
        .select('slack_user_id, org_id')
        .eq('id', userId)
        .single();
      
      if (error || !user.slack_user_id) {
        throw new Error('User not found or Slack ID not set');
      }
      
      // Get organization details
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('slack_bot_token')
        .eq('id', user.org_id)
        .single();
      
      if (orgError || !org.slack_bot_token) {
        throw new Error('Organization not found or Slack token not set');
      }
      
      // Initialize Slack client
      const { WebClient } = require('@slack/web-api');
      const client = new WebClient(org.slack_bot_token);
      
      // Send confirmation message
      await client.chat.postMessage({
        channel: user.slack_user_id,
        text: `Your GitHub account (${githubUsername}) has been successfully connected to PingaPR! 🎉`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*GitHub Connection Successful!* 🎉\n\nYour GitHub account (${githubUsername}) has been connected to PingaPR.`
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "You can now:\n• Reply to GitHub comments directly from Slack\n• Approve PRs with `/lgtm`\n• Use `/pingapr` commands to manage your PRs\n• Receive personalized PR notifications"
            }
          }
        ]
      });
      
      return true;
    } catch (error) {
      console.error('Error sending Slack confirmation:', error);
      // Don't throw - this is a non-critical error
      return false;
    }
  }
};

module.exports = githubUserAuth;
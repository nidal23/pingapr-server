const axios = require('axios');
const { supabase } = require('../supabase/client');
const config = require('../../config');
const { WebClient } = require('@slack/web-api');

const slackUserAuth = {
  /**
   * Generate Slack OAuth URL for a specific user
   * @param {string} userId - User ID
   * @returns {Promise<string>} - Auth URL
   */
  async getAuthUrl(userId) {
    try {
      // Get user details to find their organization
      const { data: user, error } = await supabase
        .from('users')
        .select('org_id, slack_user_id')
        .eq('id', userId)
        .single();
      
      if (error) {
        throw error;
      }
      
      // Create state parameter with user ID and org ID
      const state = Buffer.from(JSON.stringify({
        userId,
        orgId: user.org_id,
        redirectTo: 'slack'
      })).toString('base64');
      
      // Build Slack OAuth URL
      const url = new URL('https://slack.com/oauth/v2/authorize');
      url.searchParams.append('client_id', config.slack.clientId);
      url.searchParams.append('redirect_uri', `${process.env.SLACK_USER_REDIRECT_URI}`);
      url.searchParams.append('state', state);
      
      // Request only user scopes
      url.searchParams.append('user_scope', 'chat:write');
      
      // Don't request any bot scopes for user auth
      url.searchParams.append('scope', '');
      
      return url.toString();
    } catch (error) {
      console.error('Error generating Slack auth URL for user:', error);
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
      const { userId, orgId, redirectTo } = JSON.parse(Buffer.from(state, 'base64').toString());
      
      // Exchange code for token using Slack's OAuth endpoint
      const response = await axios.post('https://slack.com/api/oauth.v2.access', null, {
        params: {
          client_id: config.slack.clientId,
          client_secret: config.slack.clientSecret,
          code,
          redirect_uri: process.env.SLACK_USER_REDIRECT_URI
        }
      });
      
      const data = response.data;
      
      if (!data.ok) {
        throw new Error(`Slack OAuth error: ${data.error}`);
      }
      
      // Check if we got a user access token
      if (!data.authed_user || !data.authed_user.access_token) {
        throw new Error('Failed to get user access token from Slack');
      }
      
      // Update user record with the token
      await supabase
        .from('users')
        .update({
          slack_user_token: data.authed_user.access_token,
          // Store token expiration if provided
          slack_token_expires_at: data.authed_user.expires_in ? 
            new Date(Date.now() + data.authed_user.expires_in * 1000).toISOString() : 
            null
        })
        .eq('id', userId);
      
      // Send confirmation message
      await this.sendConfirmationMessage(userId);
      
      return { 
        success: true,
        userId,
        redirectTo
      };
    } catch (error) {
      console.error('Error handling Slack user auth callback:', error);
      throw error;
    }
  },
  
  /**
   * Send confirmation message 
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Success status
   */
  async sendConfirmationMessage(userId) {
    try {
      // Get user details
      const { data: user, error } = await supabase
        .from('users')
        .select('slack_user_id, org_id, github_access_token')
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
      const client = new WebClient(org.slack_bot_token);
      
      // Build blocks array
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Slack Connection Successful!* 🎉\n\nYour Slack account is now connected to PingaPR."
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Now your GitHub comments will appear in Slack as coming directly from you, and vice versa."
          }
        }
      ];
      
      // If GitHub is not connected yet, add a reminder
      if (!user.github_access_token) {
        const githubAuthUrl = `${config.app.baseUrl}/api/github/user-auth?user_id=${userId}`;
        
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*One more step:* To complete your setup, please also connect your GitHub account."
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Connect GitHub Account",
                  emoji: true
                },
                url: githubAuthUrl,
                style: "primary",
                action_id: "github_auth"
              }
            ]
          }
        );
      } else {
        // If both are connected, add a "setup complete" message
        blocks.push(
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "✅ Setup complete! You're all set to collaborate seamlessly across GitHub and Slack."
              }
            ]
          }
        );
      }
      
      // Send confirmation message
      await client.chat.postMessage({
        channel: user.slack_user_id,
        text: "Your Slack account has been successfully connected to PingaPR!",
        blocks: blocks
      });
      
      return true;
    } catch (error) {
      console.error('Error sending Slack confirmation:', error);
      // Don't throw - this is a non-critical error
      return false;
    }
  }
};

module.exports = slackUserAuth;
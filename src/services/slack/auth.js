const axios = require('axios');
const { supabase } = require('../supabase/client');
const config = require('../../config');
const { WebClient } = require('@slack/web-api');

const slackAuth = {
  // Generate Slack OAuth URL
  async getAuthUrl(userId, orgId) {
    // Create state parameter with user and org IDs
    const state = Buffer.from(JSON.stringify({
      userId,
      orgId
    })).toString('base64');
    
    // Build Slack OAuth URL
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.append('client_id', config.slack.clientId);
    url.searchParams.append('redirect_uri', config.slack.redirectUri);
    
    // Use the exact scopes from your app manifest
    url.searchParams.append('scope', [
      "app_mentions:read",
      "channels:join",
      "channels:manage",
      "channels:read",
      "channels:write.invites",
      "channels:write.topic",
      "chat:write",
      "chat:write.customize",
      "chat:write.public",
      "commands",
      "groups:read",
      "groups:write",
      "im:read",
      "im:write",
      "team:read",
      "users:read",
      "users:read.email",
      "reactions:write",
      "files:write"
    ].join(','));
    
    // Add user scopes if you need them
    url.searchParams.append('user_scope', [
      "channels:read",
      "groups:read",
      "mpim:read",
      "users:read",
      "users:read.email"
    ].join(','));
    
    url.searchParams.append('state', state);
    
    return url.toString();
  },


  /**
   * Validate Slack credentials before storing
   * @param {string} token - Slack bot token to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateSlackCredentials(token) {
    try {
      const client = new WebClient(token);
      
      // Try to call a simple API method
      const response = await client.auth.test();
      
      if (!response.ok) {
        return {
          valid: false,
          error: response.error
        };
      }
      
      return {
        valid: true,
        team: response.team,
        teamId: response.team_id,
        userId: response.user_id
      };
    } catch (error) {
      console.error('Slack token validation failed:', {
        message: error.message,
        code: error.code
      });
      
      return {
        valid: false,
        error: error.message
      };
    }
  },

  
  // Exchange code for access token
  async exchangeCodeForToken(code, state) {
    try {
      // Decode state
      const { userId, orgId } = JSON.parse(Buffer.from(state, 'base64').toString());
      
      // Exchange code for token
      const response = await axios.post('https://slack.com/api/oauth.v2.access', null, {
        params: {
          client_id: process.env.SLACK_CLIENT_ID,
          client_secret: process.env.SLACK_CLIENT_SECRET,
          code,
          redirect_uri: process.env.SLACK_REDIRECT_URI
        }
      });
      
      const data = response.data;

      const validationResult = await this.validateSlackCredentials(data.access_token);

      if (!validationResult.valid) {
        throw new Error(`Failed to validate Slack token: ${validationResult.error}`);
      }

      
      if (!data.ok) {
        throw new Error(`Slack OAuth error: ${data.error}`);
      }
      
      // Update organization with Slack details and connection status
      await supabase
        .from('organizations')
        .update({
          slack_workspace_id: data.team.id,
          slack_bot_token: data.access_token,
          slack_connected: true // Set the connection flag
        })
        .eq('id', orgId);
      
      // We're not storing the admin user token here as per request
      
      return { success: true };
    } catch (error) {
      console.error('Error exchanging code for token:', error);
      throw error;
    }
  },

  
  // Get users from Slack workspace with retry mechanism
  async getUsers(orgId) {
    try {
      // Get Slack connection
      const { data: org, error } = await supabase
        .from('organizations')
        .select('slack_bot_token')
        .eq('id', orgId)
        .single();
      
      if (error || !org.slack_bot_token) {
        throw new Error('Slack not connected');
      }
      
      // Initialize Slack client
      const client = new WebClient(org.slack_bot_token);
      
      // Get users from Slack with retry mechanism
      const members = await this.fetchSlackUsers(client);
      
      // Filter out bots, deactivated users, etc.
      const users = members
        .filter(user => !user.is_bot && !user.deleted && !user.is_restricted && !user.is_ultra_restricted)
        .map(user => ({
          id: user.id,
          name: user.profile.real_name || user.name,
          email: user.profile.email,
          avatar: user.profile.image_72
        }));
      
      return users;
    } catch (error) {
      console.error('Error getting Slack users:', error);
      throw error;
    }
  },

  // Helper function to handle rate limiting
  async fetchSlackUsers(client, retries = 3) {
    try {
      const response = await client.users.list();
      
      if (!response.ok) {
        throw new Error(`Slack API error: ${response.error}`);
      }
      
      return response.members;
    } catch (error) {
      if (error.code === 'slack_webapi_platform_error' && 
          error.data && error.data.error === 'ratelimited' && 
          retries > 0) {
        
        // Get retry delay from header or use default
        const retryAfter = parseInt(error.data.retry_after || '60', 10);
        
        console.log(`Rate limited by Slack. Retrying in ${retryAfter} seconds...`);
        
        // Wait for the specified time
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        
        // Retry with one less retry attempt
        return this.fetchSlackUsers(client, retries - 1);
      }
      
      throw error;
    }
  },

  async sendErrorMessage(token, channelId, threadTs, message) {
    try {
      const client = new WebClient(token);
      
      const result = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `:warning: ${message}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: ${message}`
            }
          }
        ]
      });
      
      return result;
    } catch (error) {
      console.error('Error sending Slack error message:', error);
      throw error;
    }
  }
};

module.exports = slackAuth;
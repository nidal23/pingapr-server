// src/api/controllers/onboarding/slack.js
const db = require('../../../services/supabase/functions');
const { WebClient } = require('@slack/web-api');
const config = require('../../../config');
const { v4: uuidv4 } = require('uuid');

// Handle Slack OAuth callback
const handleOAuthCallback = async (req, res) => {
    try {
      const { code } = req.query;
      const orgId = req.session.orgId || req.query.state;
      
      if (!code || !orgId) {
        return res.status(400).send('Missing required parameters');
      }
      
      // Exchange code for access token
      const client = new WebClient();
      const result = await client.oauth.v2.access({
        client_id: config.slack.clientId,
        client_secret: config.slack.clientSecret,
        code
      });
      
      if (!result.ok) {
        throw new Error(`Slack OAuth error: ${result.error}`);
      }
      
      // Update organization with Slack details
      await db.organizations.update(orgId, {
        slack_workspace_id: result.team.id,
        slack_bot_token: result.access_token
      });
      
      // // Create Slack connection for the organization
      // await db.slackConnections.create({
      //   org_id: orgId,
      //   team_id: result.team.id,
      //   team_name: result.team.name,
      //   access_token: result.access_token,
      //   bot_user_id: result.bot_user_id,
      //   is_connected: true
      // });
      
      // Redirect to user mapping step
      res.redirect(`/onboarding?step=user-mapping&orgId=${orgId}`);
    } catch (error) {
      console.error('Error in Slack OAuth callback:', error);
      res.status(500).send('Error processing Slack authorization');
    }
  };
  

module.exports = {
  handleOAuthCallback
};
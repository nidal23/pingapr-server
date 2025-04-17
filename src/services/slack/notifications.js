// src/services/slack/notifications.js - New file

const { WebClient } = require('@slack/web-api');
const { supabase } = require('../supabase/client');

/**
 * Send invitation messages to team members
 * @param {string} orgId - Organization ID
 * @returns {Promise<Object>} Result with counts
 */
async function sendTeamInvitations(orgId) {
  // Get organization
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('slack_bot_token')
    .eq('id', orgId)
    .single();
  
  if (orgError) throw orgError;
  
  // Get users with Slack IDs
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id, slack_user_id, github_username')
    .eq('org_id', orgId)
    .not('slack_user_id', 'is', null);
  
  if (userError) throw userError;
  
  const slackClient = new WebClient(org.slack_bot_token);
  let sent = 0;
  let failed = 0;
  
  // Send message to each user
  for (const user of users) {
    try {
      const authUrl = `${config.app.baseUrl}/api/github/user-auth?user_id=${user.id}`;
      
      await slackClient.chat.postMessage({
        channel: user.slack_user_id,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Welcome to PingaPR! To enable replying to GitHub PR comments from Slack, please connect your GitHub account."
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Once connected, you'll be able to:\n• See PR notifications in dedicated channels\n• Reply to GitHub comments directly from Slack\n• Get reminded about pending reviews"
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Connect GitHub Account"
                },
                url: authUrl,
                action_id: "github_auth"
              }
            ]
          }
        ]
      });
      
      sent++;
    } catch (error) {
      console.error(`Error sending invitation to ${user.github_username}:`, error);
      failed++;
    }
  }
  
  return { sent, failed, total: users.length };
}

module.exports = {
  sendTeamInvitations
};
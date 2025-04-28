const { WebClient } = require('@slack/web-api');
const { supabase } = require('../supabase/client');
const config = require('../../config');

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
    .select('id, slack_user_id, github_username, github_access_token, slack_user_token')
    .eq('org_id', orgId)
    .not('slack_user_id', 'is', null);
  
  if (userError) throw userError;
  
  const slackClient = new WebClient(org.slack_bot_token);
  let sent = 0;
  let failed = 0;
  
  // Send message to each user
  for (const user of users) {
    try {
      const githubAuthUrl = `${config.app.baseUrl}/api/github/user-auth?user_id=${user.id}`;
      const slackAuthUrl = `${config.app.baseUrl}/api/slack/user-auth?user_id=${user.id}`;
      
      // Check which authorizations are already completed
      const needsGitHub = !user.github_access_token;
      const needsSlack = !user.slack_user_token;
      
      // Skip if both are already done
      if (!needsGitHub && !needsSlack) {
        continue;
      }
      
      // Build blocks based on what's needed
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "👋 *Welcome to PingaPR!* 🎉\n\nI'm here to help you collaborate seamlessly between GitHub and Slack. Let's get you set up with a quick onboarding process."
          }
        },
        {
          type: "divider"
        }
      ];
      
      // Add GitHub section if needed
      if (needsGitHub) {
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*1️⃣ Connect your GitHub Account*\nThis allows you to receive PR notifications and reply directly from Slack. Click the button below to connect your GitHub account."
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Connect GitHub",
                  emoji: true
                },
                url: githubAuthUrl,
                style: "primary"
              }
            ]
          }
        );
      }
      
      // Add Slack section if needed
      if (needsSlack) {
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${needsGitHub ? "2️⃣" : "1️⃣"} Connect your Slack Account*\nThis allows your GitHub comments to appear with your Slack identity. Click the button below to authorize PingaPR.`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Connect Slack",
                  emoji: true
                },
                url: slackAuthUrl,
                // Only use 'primary' if this is the only auth needed, otherwise use default
                // Note: 'default' is not specified since that's the default value
                ...(needsGitHub ? {} : {style: "primary"})
              }
            ]
          }
        );
      }
      
      // Add benefits section
      blocks.push(
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*What you can do with PingaPR:*"
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "• Reply to GitHub comments directly from Slack\n• Approve PRs with `/lgtm` command\n• View your PR status with `/pingapr list`\n• Receive personalized PR notifications"
          }
        },
        {
          type: "divider"
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "🔍 Need help? Use `/pingapr help` in any channel or type *help* in a DM with me"
            }
          ]
        }
      );
      
      await slackClient.chat.postMessage({
        channel: user.slack_user_id,
        text: "Welcome to PingaPR! Please complete the setup process.",
        blocks: blocks
      });
      
      sent++;
    } catch (error) {
      console.error(`Error sending invitation to user ${user.id}:`, error);
      failed++;
    }
  }
  
  return { sent, failed, total: users.length };
}

module.exports = {
  sendTeamInvitations
};
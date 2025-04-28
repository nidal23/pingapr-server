// src/api/controllers/slack/commands.js
const db = require('../../../services/supabase/functions');
const slackCommands = require('../../../services/slack/commands');

/**
 * Handle Slack slash commands
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const handleCommands = async (req, res) => {
    console.log('inside commands handler')
  try {
    // Acknowledge command receipt immediately to prevent timeout
    res.status(200).send();
    
    const { command, text, user_id, channel_id, team_id, response_url, trigger_id } = req.body;
    
    console.log(`Received Slack command: ${command} with text: ${text} from user: ${user_id} in channel: ${channel_id}`);
    
    // Get organization from team_id
    const org = await db.organizations.findBySlackWorkspaceId(team_id);
    
    if (!org) {
      console.error('Organization not found for team ID:', team_id);
      await slackCommands.respondToCommand(response_url, {
        text: 'Error: Organization not connected properly. Please contact your administrator.'
      });
      return;
    }
    
    // Get user from user_id
    const user = await db.users.findBySlackUserId(org.id, user_id);
    console.log('user: ', user)
    
    switch (command) {
      case '/lgtm':
        if (!user) {
          await slackCommands.respondToCommand(response_url, {
            text: 'You need to connect your GitHub account first. Please contact your administrator.'
          });
          return;
        }
        await slackCommands.handleLGTMCommand(org, user, channel_id, response_url);
        break;
        
      case '/pingapr':
        if (text.trim() === 'open') {
          await slackCommands.openRepoSelectionModal(org, user_id, response_url, trigger_id);
        } else if (text.trim() === 'me') {
          if (!user) {
            await slackCommands.respondToCommand(response_url, {
              text: 'You need to connect your GitHub account first. Please contact your administrator.'
            });
            return;
          }
          await slackCommands.getUserPRsAndRespond(org, user, response_url);
        } else {
          await slackCommands.respondToCommand(response_url, {
            text: 'Available commands: `/pingapr open` to see all open PRs, `/pingapr me` to see your PRs'
          });
        }
        break;
        
      default:
        await slackCommands.respondToCommand(response_url, {
          text: 'Unknown command. Available commands: `/lgtm`, `/pingapr open`, `/pingapr me`'
        });
    }
  } catch (error) {
    console.error('Error handling Slack command:', error);
    // We've already sent a 200 response, so we'll use the response_url to send an error message
    if (req.body && req.body.response_url) {
      await slackCommands.respondToCommand(req.body.response_url, {
        text: 'An error occurred while processing your command. Please try again later.'
      });
    }
  }
};

module.exports = {
  handleCommands
};
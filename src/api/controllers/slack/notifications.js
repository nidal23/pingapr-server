// src/api/controllers/slack/notifications.js - New file

const slackNotifications = require('../../../services/slack/notifications');

/**
 * Send invitation messages to team members
 */
async function sendTeamInvitations(req, res) {
  try {
    const orgId = req.user.org_id;
    
    const result = await slackNotifications.sendTeamInvitations(orgId);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error sending team invitations:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  sendTeamInvitations
};
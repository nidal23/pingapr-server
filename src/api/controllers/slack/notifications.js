// src/api/controllers/slack/notifications.js - New file

const slackNotifications = require('../../../services/slack/notifications');

/**
 * Send invitations to all team members
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
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
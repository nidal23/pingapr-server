const notificationsService = require('../../../services/slack/notifications');
const { ApiError } = require('../../../middleware/error');

/**
 * Send invitations to team members
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const sendTeamInvitations = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    
    const result = await notificationsService.sendTeamInvitations(orgId);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error sending team invitations:', error);
    next(error);
  }
};

module.exports = {
  sendTeamInvitations
};
// src/api/controllers/slack/interactions.js
const slackInteractions = require('../../../services/slack/interactions');

/**
 * Handle Slack interactive components (button clicks, modals, etc.)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const handleInteractions = async (req, res) => {
  try {
    // Acknowledge receipt immediately to prevent timeout
    res.status(200).send();
    
    // Get payload from request body
    const { payload } = req.body;
    
    // Process the interaction payload
    await slackInteractions.processInteractionPayload(payload);
  } catch (error) {
    console.error('Error handling Slack interaction:', error);
  }
};

module.exports = {
  handleInteractions
};
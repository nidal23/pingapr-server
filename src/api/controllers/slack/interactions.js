// src/api/controllers/slack/interactions.js
const slackInteractions = require('../../../services/slack/interactions');

/**
 * Handle Slack interactive components (button clicks, modals, etc.)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const handleInteractions = async (req, res) => {
  // Acknowledge receipt immediately to prevent timeout
  // This ensures Slack gets a quick response and won't retry
  res.status(200).send();
  
  // Process the interaction asynchronously
  processInteraction(req.body)
    .catch(error => {
      // Safe error logging
      const safeError = {
        message: error.message,
        code: error.code,
        status: error.status
      };
      
      // Use limited payload info to avoid logging sensitive data
      const payload = typeof req.body.payload === 'string' 
        ? JSON.parse(req.body.payload) 
        : req.body.payload;
        
      console.error('Error processing Slack interaction:', safeError, {
        type: payload?.type,
        actionId: payload?.actions?.[0]?.action_id,
        callbackId: payload?.callback_id || payload?.view?.callback_id
      });
    });
};

/**
 * Process Slack interaction asynchronously
 * @param {Object} interactionData - Interaction data from Slack
 */
const processInteraction = async (interactionData) => {
  let payload = interactionData.payload;
  
  // If payload is a string, parse it
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      console.error('Error parsing interaction payload:', error.message);
      return;
    }
  }
  
  // Process the interaction payload
  await slackInteractions.processInteractionPayload(payload);
};

module.exports = {
  handleInteractions
};
// src/services/slack/interactions.js
const db = require('../supabase/functions');
const slackCommands = require('./commands');

/**
 * Handle view submission (modal form submissions)
 * @param {Object} payload - Slack view submission payload
 * @returns {Promise<void>}
 */
const handleViewSubmission = async (payload) => {
  const { view, user } = payload;
  
  // Check callback_id to determine which modal was submitted
  switch (view.callback_id) {
    case 'repo_selection_modal':
      await handleRepoSelectionSubmission(view, user);
      break;
      
    default:
      console.warn(`Unhandled view submission: ${view.callback_id}`);
  }
};

/**
 * Handle block actions (button clicks, dropdown selections, etc.)
 * @param {Object} payload - Slack block actions payload
 * @returns {Promise<void>}
 */
const handleBlockActions = async (payload) => {
  // Extract action ID from the first action
  const action = payload.actions?.[0];
  if (!action) return;
  
  switch (action.action_id) {
    // Add specific action handlers as needed
    default:
      console.warn(`Unhandled block action: ${action.action_id}`);
  }
};

/**
 * Handle repository selection modal submission
 * @param {Object} view - Slack view payload
 * @param {Object} user - Slack user who submitted
 * @returns {Promise<void>}
 */
/**
 * Process selected repository and show PRs
 * @param {string} orgId - Organization ID
 * @param {string} repoId - Repository ID ("all" for all repos)
 * @param {string} responseUrl - Slack response URL
 * @returns {Promise<void>}
 */
const processRepoSelectionAndShowPRs = async (orgId, repoId, responseUrl) => {
  try {
    // Get organization data
    const org = await db.organizations.findById(orgId);
    if (!org) {
      console.error(`Organization not found: ${orgId}`);
      return;
    }
    
    // Fetch PRs based on selection
    let prs = [];
    if (repoId === 'all') {
      prs = await slackCommands.getAllOpenPRs(orgId);
    } else {
      prs = await slackCommands.getOpenPRsForRepo(repoId);
    }
    
    // Format PRs into blocks
    const blocks = slackCommands.formatPRList(prs);
    
    // Respond using the response_url
    await slackCommands.respondToCommand(responseUrl, {
      blocks,
      replace_original: true,
      text: `${prs.length} open pull request${prs.length !== 1 ? 's' : ''}`
    });
  } catch (error) {
    console.error('Error processing repo selection:', error);
    
    try {
      await slackCommands.respondToCommand(responseUrl, {
        text: 'An error occurred while fetching pull requests. Please try again later.'
      });
    } catch (innerError) {
      console.error('Error sending failure response:', innerError);
    }
  }
};

/**
 * Handle repository selection modal submission
 * @param {Object} view - Slack view payload
 * @param {Object} user - Slack user who submitted
 * @returns {Promise<void>}
 */
const handleRepoSelectionSubmission = async (view, user) => {
  try {
    // Get private metadata (contains response_url and org_id)
    const metadata = JSON.parse(view.private_metadata || '{}');
    const { response_url, org_id } = metadata;
    
    if (!response_url || !org_id) {
      console.error('Missing required metadata in view submission');
      return;
    }
    
    // Get the selected repository ID
    const repoId = view.state.values.repo_selection_block.repo_selection_action.selected_option.value;
    
    // Process the repository selection and show PRs
    await processRepoSelectionAndShowPRs(org_id, repoId, response_url);
  } catch (error) {
    console.error('Error handling repo selection submission:', error);
    
    // Try to send an error message if we have response_url
    try {
      const metadata = JSON.parse(view.private_metadata || '{}');
      if (metadata.response_url) {
        await slackCommands.respondToCommand(metadata.response_url, {
          text: 'An error occurred while fetching pull requests. Please try again later.'
        });
      }
    } catch (innerError) {
      console.error('Error sending failure response:', innerError);
    }
  }
};

/**
 * Parse and route interaction payloads to appropriate handlers
 * @param {Object|string} payload - Slack interaction payload (may be string or object)
 * @returns {Promise<void>}
 */
const processInteractionPayload = async (payload) => {
  // Ensure payload is an object
  const payloadObj = typeof payload === 'string' 
    ? JSON.parse(payload)
    : payload;
  
  // Log interaction for debugging
  console.log(`Processing Slack interaction: ${payloadObj.type} with action: ${JSON.stringify(payloadObj.actions || payloadObj.view || {})}`);
  
  // Route to appropriate handler based on interaction type
  switch (payloadObj.type) {
    case 'view_submission':
      await handleViewSubmission(payloadObj);
      break;
      
    case 'block_actions':
      await handleBlockActions(payloadObj);
      break;
      
    default:
      console.warn(`Unhandled interaction type: ${payloadObj.type}`);
  }
};

module.exports = {
  processInteractionPayload,
  handleViewSubmission,
  handleBlockActions,
  handleRepoSelectionSubmission,
  processRepoSelectionAndShowPRs
};
const githubService = require('../../../services/github/webhooks')

/**
 * Process GitHub webhook event
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const handleWebhook = async (req, res, next) => {
  try {
    // Get event type from headers
    const event = req.headers['x-github-event'];
    
    if (!event) {
      throw new ApiError(400, 'Missing GitHub event type');
    }
    
    // Acknowledge receipt immediately to prevent GitHub retries
    // Always respond with 202 Accepted, regardless of processing outcome
    res.status(202).json({
      status: 'received',
      event,
      message: `Event ${event} received and queued for processing`
    });
    
    // Now process the event asynchronously
    processWebhookEvent(event, req.body).catch(error => {
      console.error(`Error processing GitHub webhook event ${event}:`, {
        message: error.message,
        event,
        // Include limited payload info for debugging but avoid sensitive data
        repo: req.body.repository?.full_name,
        action: req.body.action
      });
    });
  } catch (error) {
    // For request validation errors, respond accordingly
    console.error(`Error validating GitHub webhook:`, {
      message: error.message,
      event: req.headers['x-github-event']
    });
    
    // Already sent a response in the try block
    // No need to pass to next()
  }
};

/**
 * Process webhook event asynchronously
 * @param {string} event - Event type
 * @param {Object} payload - Webhook payload
 */
const processWebhookEvent = async (event, payload) => {
  let result;
  
  switch (event) {
    case 'ping':
      result = await githubService.handlePingEvent(payload);
      break;
      
    case 'pull_request':
      result = await githubService.handlePullRequestEvent(payload);
      break;
      
    case 'pull_request_review':
      // Check for empty reviews with just a single comment (these are noise)
      if (payload.action === 'submitted' && 
          payload.review.body === null && 
          payload.review.state === 'commented') {
        console.log(`[WEBHOOK] Detected likely single-comment review, checking...`);
        
        // This is a simple optimization to avoid unnecessary API calls
        // for the most common case of a single comment masquerading as a review
        setTimeout(async () => {
          try {
            // Delayed processing to let the review_comment event be processed first
            await githubService.handlePullRequestReviewEvent(payload);
          } catch (error) {
            console.error(`[WEBHOOK] Error in delayed review processing:`, {
              message: error.message,
              reviewId: payload.review?.id
            });
          }
        }, 2000); // 2 second delay
        
        // Indicate that processing was queued
        result = { 
          status: 'queued', 
          reason: 'Empty review detected, queued for delayed processing' 
        };
      } else {
        // Process normally
        result = await githubService.handlePullRequestReviewEvent(payload);
      }
      break;
      
    case 'pull_request_review_comment':
      // Only handle individual comments in a review
      result = await githubService.handlePullRequestReviewCommentEvent(payload);
      break;
      
    case 'issue_comment':
      // Only process issue comments for pull requests
      if (payload.issue && payload.issue.pull_request) {
        // Check if this comment originated from Slack
        if (payload.comment && payload.comment.body.includes('<!-- SENT_FROM_SLACK -->')) {
          result = { status: 'ignored', reason: 'Comment originated from Slack, ignoring to prevent duplication' };
        } else {
          result = await githubService.handlePullRequestCommentEvent(payload);
        }
      } else {
        // We're not handling regular issue comments
        result = { status: 'ignored', reason: 'Not a pull request comment' };
      }
      break;
      
    default:
      // Note we're ignoring this event type
      result = { status: 'ignored', reason: `Event type '${event}' not handled` };
  }
  
  return result;
};

module.exports = {
  handleWebhook
};
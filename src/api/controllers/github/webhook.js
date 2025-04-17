/**
 * GitHub webhook controller
 * Handles GitHub webhook events and delegates to appropriate handlers
 */
const { ApiError } = require('../../../middleware/error');
const githubService = require('../../../services/github/webhooks');

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
    
    // Process event based on type
    let result;
    
    switch (event) {
      case 'ping':
        result = await githubService.handlePingEvent(req.body);
        break;
        
      case 'pull_request':
        result = await githubService.handlePullRequestEvent(req.body);
        break;
        
      case 'pull_request_review':
        result = await githubService.handlePullRequestReviewEvent(req.body);
        break;
        
      case 'pull_request_review_comment':
        result = await githubService.handlePullRequestReviewCommentEvent(req.body);
        break;
        
      case 'issue_comment':
        // Only process issue comments for pull requests
        if (req.body.issue && req.body.issue.pull_request) {
          result = await githubService.handlePullRequestCommentEvent(req.body);
        } else {
          // We're not handling regular issue comments
          result = { status: 'ignored', reason: 'Not a pull request comment' };
        }
        break;
        
      default:
        // Respond with success but note we're ignoring this event type
        result = { status: 'ignored', reason: `Event type '${event}' not handled` };
    }
    
    // Respond immediately to GitHub
    res.status(202).json({
      status: 'received',
      event,
      message: `Event ${event} processed successfully`,
      result
    });
  } catch (error) {
    // Still respond with success to GitHub to avoid retries
    // but log the error for our attention
    console.error(`Error processing GitHub webhook: ${error.message}`, error);
    
    res.status(202).json({
      status: 'error',
      message: `Error processing event: ${error.message}`
    });
    
    // Don't pass to next() as we've already sent a response
  }
};

module.exports = {
  handleWebhook
};
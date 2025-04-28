const slackUserAuth = require('../../../services/slack/userAuth');

/**
 * Generate Slack authorization URL for a specific user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUserAuthUrl = async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    
    if (!userId) {
      return res.status(400).send('Missing user_id parameter');
    }
    
    const url = await slackUserAuth.getAuthUrl(userId);
    
    // Redirect directly to Slack
    res.redirect(url);
  } catch (error) {
    console.error('Error generating user auth URL:', error);
    res.redirect(`${process.env.FRONTEND_URL}/error?message=slack_auth_url_failed`);
  }
};

/**
 * Handle Slack OAuth callback for user authorization
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const handleUserCallback = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }
    
    const result = await slackUserAuth.handleCallback(code, state);
    
    // Redirect to success page
    res.redirect(`${process.env.FRONTEND_URL}/auth-success/${result.redirectTo || 'slack'}`);
  } catch (error) {
    console.error('Slack user callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/error?service=slack&message=${encodeURIComponent('Slack authentication failed')}`);
  }
};

module.exports = {
  getUserAuthUrl,
  handleUserCallback
};
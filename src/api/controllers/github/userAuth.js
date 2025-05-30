const githubUserAuth = require('../../../services/github/userAuth');

/**
 * Generate GitHub authorization URL for a specific user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUserAuthUrl = async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    const redirectTo = req.query.redirect_to || 'github'; // Default to github
    
    if (!userId) {
      return res.status(400).send('Missing user_id parameter');
    }
    
    const url = await githubUserAuth.getAuthUrl(userId, redirectTo);
    
    // Redirect directly to GitHub
    res.redirect(url);
  } catch (error) {
    console.error('Error generating user auth URL:', error);
    res.redirect(`${process.env.FRONTEND_URL}/error?message=github_auth_url_failed`);
  }
};

/**
 * Handle GitHub OAuth callback for user authorization
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
    
    const result = await githubUserAuth.handleCallback(code, state);
    
    // Redirect to appropriate success page
    res.redirect(`${process.env.FRONTEND_URL}/auth-success/${result.redirectTo || 'github'}`);
  } catch (error) {
    console.error('GitHub user callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/error?service=github&message=${encodeURIComponent('GitHub authentication failed')}`);
  }
};

module.exports = {
  getUserAuthUrl,
  handleUserCallback
};
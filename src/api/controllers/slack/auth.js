// src/api/controllers/slack/auth.js
const slackService = require('../../../services/slack/auth');
const { ApiError } = require('../../../middleware/error');

// Get Slack authorization URL
const getAuthUrl = async (req, res, next) => {
  try {
    const url = await slackService.getAuthUrl(req.user.id, req.organization.id);
    res.json({ url });
  } catch (error) {
    next(error);
  }
};

// Handle Slack OAuth callback
const handleCallback = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }
    
    await slackService.exchangeCodeForToken(code, state);
    
    // Redirect to frontend onboarding page
    res.redirect(`${process.env.FRONTEND_URL}/onboarding?step=user-mapping`);
  } catch (error) {
    console.error('Slack callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=slack_auth_failed`);
  }
};

// Get Slack users
const getUsers = async (req, res, next) => {
  try {
    const users = await slackService.getUsers(req.organization.id);
    res.json(users);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAuthUrl,
  handleCallback,
  getUsers
};
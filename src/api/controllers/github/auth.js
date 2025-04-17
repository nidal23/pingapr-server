// src/api/controllers/github/auth.js
const githubService = require('../../../services/github/auth');
const { ApiError } = require('../../../middleware/error');

// Get GitHub authorization URL
const getAuthUrl = async (req, res, next) => {
  try {
    const url = await githubService.getAuthUrl(req.user.id, req.organization.id);
    res.json({ url });
  } catch (error) {
    next(error);
  }
};

// Get GitHub App installation URL
const getInstallationUrl = async (req, res, next) => {
    try {
      const url = await githubService.getInstallationUrl(req.organization.id);
      res.json({ url });
    } catch (error) {
      next(error);
    }
  };


const getUsers = async (req, res, next) => {
  try {
    const users = await githubService.getUsers(req.organization.id);
    res.json(users);
  } catch (error) {
    next(error);
  }
};


// Handle GitHub App installation callback
const handleInstallationCallback = async (req, res, next) => {
    try {
      const { installation_id, state } = req.query;
      
      if (!installation_id || !state) {
        return res.status(400).send('Missing parameters');
      }
      
      await githubService.handleInstallation(installation_id, state);
      
      res.redirect(`${process.env.FRONTEND_URL}/onboarding?step=repositories`);
    } catch (error) {
      console.error('GitHub installation error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=github_installation_failed`);
    }
  };
// Handle GitHub OAuth callback
const handleCallback = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }
    
    await githubService.exchangeCodeForToken(code, state);
    
    // Redirect to frontend onboarding page
    res.redirect(`${process.env.FRONTEND_URL}/onboarding?step=repositories`);
  } catch (error) {
    console.error('GitHub callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/onboarding?error=github_auth_failed`);
  }
};

// Get repositories
const getRepositories = async (req, res, next) => {
  try {
    const repositories = await githubService.getRepositories(req.organization.id);
    res.json(repositories);
  } catch (error) {
    next(error);
  }
};

// Toggle repository
const toggleRepository = async (req, res, next) => {
  try {
    const { repoId, isActive } = req.body;
    
    if (!repoId) {
      throw new ApiError(400, 'Repository ID is required');
    }
    
    const repository = await githubService.toggleRepository(
      req.organization.id,
      repoId,
      isActive !== false
    );
    
    res.json(repository);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAuthUrl,
  handleCallback,
  getRepositories,
  toggleRepository,
  handleInstallationCallback,
  getInstallationUrl,
  getUsers
};
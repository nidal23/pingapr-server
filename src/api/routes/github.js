/**
 * GitHub API routes
 */
const express = require('express');
const router = express.Router();
const { verifyJWT, verifyGitHubWebhook } = require('../../middleware/auth');
const githubWebhookController = require('../controllers/github/webhook');
const githubAuthController = require('../controllers/github/auth');
const githubUserAuthController = require('../controllers/github/userAuth');


// Public routes (callbacks from GitHub)
router.get('/callback', githubAuthController.handleInstallationCallback);
router.get('/user-auth', githubUserAuthController.getUserAuthUrl);
router.get('/user-auth/callback', githubUserAuthController.handleUserCallback);

// Protected routes
router.get('/auth-url', verifyJWT, githubAuthController.getAuthUrl);
router.get('/repositories', verifyJWT, githubAuthController.getRepositories);
router.post('/repositories/toggle', verifyJWT, githubAuthController.toggleRepository);
router.get('/installation-url', verifyJWT, githubAuthController.getInstallationUrl);

/**
 * GitHub webhook endpoint
 * POST /api/github/webhook
 */
router.post('/webhook', verifyGitHubWebhook, githubWebhookController.handleWebhook);
router.get('/users', verifyJWT, githubAuthController.getUsers);



module.exports = router;
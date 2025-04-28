// src/api/routes/slack.js
const express = require('express');
const router = express.Router();
const slackEventController = require('../controllers/slack/events');
const slackInteractionController = require('../controllers/slack/interactions');
const slackCommandController = require('../controllers/slack/commands');
const slackController = require('../controllers/slack/auth');
const { verifySlackRequest } = require('../../middleware/slack-verify');
const { verifyJWT } = require('../../middleware/auth')
const slackNotificationController = require('../controllers/slack/notifications')
const slackUserAuthController = require('../controllers/slack/userAuth')
//Slack related Auth
router.get('/callback', slackController.handleCallback);


// router.post('/exchange-code', authMiddleware, slackController.exchangeCode);
router.get('/auth-url', verifyJWT, slackController.getAuthUrl);
router.get('/users', verifyJWT, slackController.getUsers);


router.get('/user-auth', slackUserAuthController.getUserAuthUrl);
router.get('/user-auth/callback', slackUserAuthController.handleUserCallback);

// Handle Slack events (messages, etc.)
router.post('/events', verifySlackRequest, slackEventController.handleEvents);


// Handle Slack interactive components (buttons, menus, etc.)
router.post('/interactions', verifySlackRequest, slackInteractionController.handleInteractions)
router.post('/send-invitations', verifyJWT, slackNotificationController.sendTeamInvitations);


// Handle Slack slash commands
router.post('/commands', (req, res, next) => {
    console.log('Slack command headers:', req.headers);
    console.log('Slack command body:', req.body);
    next();
  }, slackCommandController.handleCommands);

module.exports = router;
// src/api/routes/slack.js
const express = require('express');
const router = express.Router();
// const slackEventController = require('../controllers/slack/events');
// const slackInteractionController = require('../controllers/slack/interactions');
// const slackCommandController = require('../controllers/slack/commands');
const slackController = require('../controllers/slack/auth');
const { verifyJWT } = require('../../middleware/auth');
const slackNotificationController = require('../controllers/slack/notifications')

//Slack related Auth

router.get('/callback', slackController.handleCallback);


// router.post('/exchange-code', authMiddleware, slackController.exchangeCode);
router.get('/auth-url', verifyJWT, slackController.getAuthUrl);
router.get('/users', verifyJWT, slackController.getUsers);


// Handle Slack events (messages, etc.)
// router.post('/events', verifyJWT, slackEventController.handleEvents);

// Handle Slack interactive components (buttons, menus, etc.)
router.post('/send-invitations', verifyJWT, slackNotificationController.sendTeamInvitations);

// Handle Slack slash commands
// router.post('/commands', verifyJWT, slackCommandController.handleCommands);

module.exports = router;
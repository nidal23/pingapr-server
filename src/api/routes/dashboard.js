// src/api/routes/dashboard.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard');
const { verifyJWT } = require('../../middleware/auth');

// All routes are protected
router.use(verifyJWT);

// Main Dashboard
router.get('/metrics', dashboardController.getDashboardMetrics);

// Standup Dashboard
router.get('/standup', dashboardController.getStandupData);
router.post('/standup/discussion-points', dashboardController.createDiscussionPoint);
router.delete('/standup/discussion-points/:id', dashboardController.deleteDiscussionPoint);

// PR Analytics Dashboard
router.get('/analytics', dashboardController.getAnalyticsData);

// Team Collaboration Dashboard
router.get('/collaboration', dashboardController.getCollaborationData);


// Teams routes
router.get('/teams', dashboardController.getTeams);
router.get('/teams/:id', dashboardController.getTeam);
router.get('/teams/:id/members', dashboardController.getTeamMembers);
router.get('/members', dashboardController.getMembers);
router.post('/teams', dashboardController.createTeam);
router.put('/teams/:id', dashboardController.updateTeam);
router.delete('/teams/:id', dashboardController.deleteTeam);

module.exports = router;
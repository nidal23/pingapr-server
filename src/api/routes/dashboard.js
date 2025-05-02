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

module.exports = router;
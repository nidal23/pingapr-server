/**
 * Main routes index
 * Aggregates and exports all API routes
 */
const express = require('express');
const router = express.Router();
const { notFoundHandler } = require('../../middleware/error');

// Import all routes
const healthRoutes = require('./health');
const githubRoutes = require('./github');
const slackRoutes = require('./slack');
const adminRoutes = require('./admin');
const onboardingRoutes = require('./onboarding');

// Apply routes
router.use('/health', healthRoutes);
router.use('/github', githubRoutes);
router.use('/slack', slackRoutes);
router.use('/admin', adminRoutes);
router.use('/onboarding', onboardingRoutes);

// 404 handler for API routes
router.use(notFoundHandler);

module.exports = router;
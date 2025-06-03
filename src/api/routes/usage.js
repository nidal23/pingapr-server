// src/api/routes/usage.js
const express = require('express');
const router = express.Router();
const usageController = require('../controllers/usage');
const { verifyJWT } = require('../../middleware/auth');

// All routes are protected
router.use(verifyJWT);

// Get current usage statistics
router.get('/stats', usageController.getUsageStats);

// Check limits
router.get('/check/pr-limit', usageController.checkPRLimit);
router.get('/check/user-limit', usageController.checkUserLimit);

// Subscription management
router.post('/upgrade', usageController.upgradeToProfessional);
router.post('/downgrade', usageController.downgradeToFree);

// Admin functions
router.post('/reset-pr-count', usageController.resetPRCount);
router.get('/analytics', usageController.getUsageAnalytics);

module.exports = router;
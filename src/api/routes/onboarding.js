// src/routes/onboarding.js
const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboarding');
const { verifyJWT } = require('../../middleware/auth');

// All routes are protected
router.use(verifyJWT);

router.get('/status', onboardingController.getStatus);
router.post('/user-mappings', onboardingController.saveUserMappings);
// router.post('/settings', onboardingController.saveSettings);
router.post('/complete', onboardingController.completeOnboarding);

module.exports = router;
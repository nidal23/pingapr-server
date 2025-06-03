const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billing');
const { verifyJWT } = require('../../middleware/auth');

// All billing routes require authentication
router.use(verifyJWT);

// Get billing information
router.get('/info', billingController.getBillingInfo);

// Create checkout session
router.post('/checkout', billingController.createCheckoutSession);

// Get subscription status
// router.get('/subscription', billingController.getSubscriptionStatus);

// Manual upgrade (for testing - remove in production)
// if (process.env.NODE_ENV !== 'production') {
//   router.post('/upgrade', billingController.upgradeOrganization);
// }

module.exports = router;
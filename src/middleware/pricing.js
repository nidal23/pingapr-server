// src/middleware/pricing.js
const usageService = require('../services/usage');

/**
 * Middleware to check PR creation limits
 */
const checkPRLimit = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const canCreate = await usageService.canCreatePR(orgId);
    
    if (!canCreate.allowed) {
      return res.status(402).json({
        error: 'Payment Required',
        message: canCreate.reason,
        code: 'UPGRADE_REQUIRED'
      });
    }
    
    next();
  } catch (error) {
    console.error('Error in pricing middleware:', error);
    next(); // Allow through on error
  }
};

module.exports = { checkPRLimit };
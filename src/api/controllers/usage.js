// src/api/controllers/usage.js
const usageService = require('../../services/usage');
const { ApiError } = require('../../middleware/error');

/**
 * Get current usage statistics for the organization
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUsageStats = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const stats = await usageService.getUsageStats(orgId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Check if organization can create a new PR
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const checkPRLimit = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const result = await usageService.canCreatePR(orgId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Check if organization can add more users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const checkUserLimit = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const result = await usageService.canAddUser(orgId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Upgrade organization to Professional tier
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const upgradeToProfessional = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    
    // Check if user is admin
    if (!req.user.is_admin) {
      throw new ApiError(403, 'Only admin users can upgrade subscription');
    }
    
    const updatedOrg = await usageService.upgradeToProfessional(orgId);
    
    res.json({
      success: true,
      message: 'Successfully upgraded to Professional tier',
      data: updatedOrg
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Downgrade organization to FREE tier
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const downgradeToFree = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    
    // Check if user is admin
    if (!req.user.is_admin) {
      throw new ApiError(403, 'Only admin users can downgrade subscription');
    }
    
    const updatedOrg = await usageService.downgradeToFree(orgId);
    
    res.json({
      success: true,
      message: 'Successfully downgraded to FREE tier',
      data: updatedOrg
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reset monthly PR count (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const resetPRCount = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    
    // Check if user is admin
    if (!req.user.is_admin) {
      throw new ApiError(403, 'Only admin users can reset PR count');
    }
    
    const updatedOrg = await usageService.resetMonthlyPRCount(orgId);
    
    res.json({
      success: true,
      message: 'Successfully reset monthly PR count',
      data: updatedOrg
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get usage analytics for all organizations (super admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUsageAnalytics = async (req, res, next) => {
  try {
    // This would typically require a super admin check
    // For now, we'll just check if user is admin
    if (!req.user.is_admin) {
      throw new ApiError(403, 'Only admin users can view usage analytics');
    }
    
    const analytics = await usageService.getUsageAnalytics();
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsageStats,
  checkPRLimit,
  checkUserLimit,
  upgradeToProfessional,
  downgradeToFree,
  resetPRCount,
  getUsageAnalytics
};
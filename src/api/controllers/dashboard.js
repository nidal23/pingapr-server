// src/api/controllers/dashboard.js
const dashboardService = require('../../services/dashboard');
const { ApiError } = require('../../middleware/error');

/**
 * Get dashboard metrics
 * Main dashboard overview data
 */
const getDashboardMetrics = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const data = await dashboardService.getDashboardMetrics(orgId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Get standup dashboard data
 * Data for team standup meetings
 */
const getStandupData = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const period = req.query.period || 'daily';
    const repoId = req.query.repoId || null;
    
    const data = await dashboardService.getStandupData(orgId, period, repoId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a discussion point for standup
 */
const createDiscussionPoint = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const userId = req.user.id;
    const { text, type } = req.body;
    
    if (!text) {
      throw new ApiError(400, 'Text is required');
    }
    
    if (!['blocker', 'discussion', 'announcement'].includes(type)) {
      throw new ApiError(400, 'Invalid type. Must be one of: blocker, discussion, announcement');
    }
    
    const point = await dashboardService.createDiscussionPoint(orgId, userId, text, type);
    res.status(201).json(point);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a discussion point
 */
const deleteDiscussionPoint = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const pointId = req.params.id;
    
    await dashboardService.deleteDiscussionPoint(orgId, pointId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * Get PR analytics data
 * Data for analytics dashboard
 */
const getAnalyticsData = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const period = req.query.period || 'monthly';
    const repoId = req.query.repoId || null;
    
    const data = await dashboardService.getAnalyticsData(orgId, period, repoId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Get team collaboration data
 * Data for team collaboration dashboard
 */
const getCollaborationData = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const period = req.query.period || 'monthly';
    const repoId = req.query.repoId || null;
    
    const data = await dashboardService.getCollaborationData(orgId, period, repoId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardMetrics,
  getStandupData,
  createDiscussionPoint,
  deleteDiscussionPoint,
  getAnalyticsData,
  getCollaborationData
};
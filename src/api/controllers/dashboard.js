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
    const teamId = req.query.teamId || null;
    
    const data = await dashboardService.getStandupData(orgId, period, repoId, teamId);
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
    const teamId = req.query.teamId || null;
    
    const data = await dashboardService.getAnalyticsData(orgId, period, repoId, teamId);
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
    const teamId = req.query.teamId || null;

    
    const data = await dashboardService.getCollaborationData(orgId, period, repoId, teamId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};


/**
 * Get all teams for an organization
 */
const getTeams = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const data = await dashboardService.getTeams(orgId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific team by ID
 */
const getTeam = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const teamId = req.params.id;
    
    const data = await dashboardService.getTeamById(orgId, teamId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Get members of a specific team
 */
const getTeamMembers = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const teamId = req.params.id;
    
    const data = await dashboardService.getTeamMembers(orgId, teamId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all organization members
 */
const getMembers = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const data = await dashboardService.getOrgMembers(orgId);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new team
 */
const createTeam = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const { name, member_ids } = req.body;
    
    if (!name) {
      throw new ApiError(400, 'Team name is required');
    }
    
    if (!Array.isArray(member_ids)) {
      throw new ApiError(400, 'member_ids must be an array');
    }
    
    // Check if user is admin
    if (!req.user.is_admin) {
      throw new ApiError(403, 'Only admin users can create teams');
    }
    
    const team = await dashboardService.createTeam(orgId, name, member_ids);
    res.status(201).json(team);
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing team
 */
const updateTeam = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const teamId = req.params.id;
    const { name, member_ids } = req.body;
    
    if (!name) {
      throw new ApiError(400, 'Team name is required');
    }
    
    if (!Array.isArray(member_ids)) {
      throw new ApiError(400, 'member_ids must be an array');
    }
    
    // Check if user is admin
    if (!req.user.is_admin) {
      throw new ApiError(403, 'Only admin users can update teams');
    }
    
    const team = await dashboardService.updateTeam(orgId, teamId, name, member_ids);
    res.json(team);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a team
 */
const deleteTeam = async (req, res, next) => {
  try {
    const orgId = req.organization.id;
    const teamId = req.params.id;
    
    // Check if user is admin
    if (!req.user.is_admin) {
      throw new ApiError(403, 'Only admin users can delete teams');
    }
    
    await dashboardService.deleteTeam(orgId, teamId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDashboardMetrics,
  getStandupData,
  createDiscussionPoint,
  deleteDiscussionPoint,
  getAnalyticsData,
  getCollaborationData,

    // Teams exports
  getTeams,
  getTeam,
  getTeamMembers,
  getMembers,
  createTeam,
  updateTeam,
  deleteTeam
};
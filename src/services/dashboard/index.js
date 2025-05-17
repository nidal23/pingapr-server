// src/services/dashboard/index.js
const { supabase } = require('../supabase/client');
const { ApiError } = require('../../middleware/error');
const { 
  pullRequests, 
  reviewRequests, 
  users, 
  repositories, 
  comments 
} = require('../supabase/functions');
const { v4: uuidv4 } = require('uuid');

/**
 * Dashboard service for retrieving metrics and analytics data
 */
const dashboardService = {
  /**
   * Get main dashboard metrics
   * @param {string} orgId - Organization ID
   * @returns {Promise<Object>} Dashboard metrics
   */
  async getDashboardMetrics(orgId) {
    // Get repositories for this organization
    const repos = await repositories.findByOrgId(orgId);
    
    if (!repos.length) {
      return {
        prStatusCounts: { total_prs: 0, open_prs: 0, merged_prs: 0, closed_prs: 0 },
        timeMetrics: { avg_hours_to_first_review: 0, avg_hours_to_merge: 0 },
        repositoryActivity: [],
        recentPRs: [],
        weeklyActivity: []
      };
    }
    
    // Get repository IDs
    const repoIds = repos.map(repo => repo.id);
    
    // Get PR status counts
    const prStatusCounts = await this.getPRStatusCounts(repoIds);
    
    // Get time metrics
    const timeMetrics = await this.getTimeMetrics(orgId);
    
    // Get repository activity by querying PR counts per repo
    const repositoryActivity = await Promise.all(
      repos.map(async (repo) => {
        const { data, error } = await supabase
          .from('pull_requests')
          .select('status')
          .eq('repo_id', repo.id);
        
        if (error) throw error;
        
        const activity = {
          github_repo_name: repo.github_repo_name,
          open_prs: 0,
          merged_prs: 0,
          closed_prs: 0,
          total_prs: data.length
        };
        
        // Count statuses in memory
        data.forEach(item => {
          if (item.status === 'open') activity.open_prs++;
          if (item.status === 'merged') activity.merged_prs++;
          if (item.status === 'closed') activity.closed_prs++;
        });
        
        return activity;
      })
    );
    
    // Get recent PRs with reviewers
    const { data: recentPRsData, error } = await supabase
      .from('pull_requests')
      .select(`
        id,
        title,
        github_pr_number,
        status,
        created_at,
        updated_at,
        repo_id,
        author_id
      `)
      .in('repo_id', repoIds)
      .order('updated_at', { ascending: false })
      .limit(10);
    
    if (error) throw error;
    
    // Enrich PR data with repository and author details
    const recentPRs = await Promise.all(
      recentPRsData.map(async (pr) => {
        // Get repository details
        const repo = repos.find(r => r.id === pr.repo_id);
        
        // Get author details
        const author = await users.findById(pr.author_id);
        
        // Get reviewers
        const reviewersData = await pullRequests.getReviewRequests(pr.id);
        
        const reviewers = reviewersData.map(rr => {
          const reviewer = rr.reviewer;
          return {
            name: reviewer.github_username || 'Unknown',
            github_username: reviewer.github_username,
            status: rr.status,
            avatar_url: reviewer?.avatar_url          };
        });
        
        return {
          id: pr.id,
          title: pr.title,
          github_pr_number: pr.github_pr_number,
          status: pr.status,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          github_repo_name: repo?.github_repo_name || 'Unknown',
          author_name: author?.name || author?.github_username || 'Unknown',
          author_username: author?.github_username || 'Unknown',
          author_avatar:author?.avatar_url || '',
          reviewers
        };
      })
    );
    
    // Get weekly PR activity for the last 12 weeks
    const weeklyActivity = await this.getWeeklyActivity(repoIds);
    
    return {
      prStatusCounts,
      timeMetrics,
      repositoryActivity,
      recentPRs,
      weeklyActivity
    };
  },
  
  /**
   * Get PR status counts
   * @param {string[]} repoIds - Repository IDs
   * @returns {Promise<Object>} PR status counts
   */
  async getPRStatusCounts(repoIds) {
    // Get all PRs for the repositories
    const { data: prs, error } = await supabase
      .from('pull_requests')
      .select('status')
      .in('repo_id', repoIds);
    
    if (error) throw error;
    
    // Initialize counts
    const prStatusCounts = {
      total_prs: prs.length,
      open_prs: 0,
      merged_prs: 0,
      closed_prs: 0
    };
    
    // Count statuses in memory
    prs.forEach(pr => {
      if (pr.status === 'open') prStatusCounts.open_prs++;
      if (pr.status === 'merged') prStatusCounts.merged_prs++;
      if (pr.status === 'closed') prStatusCounts.closed_prs++;
    });
    
    return prStatusCounts;
  },
  
  /**
   * Get time metrics (avg time to first review, avg time to merge)
   * @param {string} orgId - Organization ID
   * @returns {Promise<Object>} Time metrics
   */
  async getTimeMetrics(orgId) {
    // For calculating average time to first review
    let avgTimeToFirstReview = 0;
    let totalPRsWithReviews = 0;

    // For calculating average time to merge
    let avgTimeToMerge = 0;
    let totalMergedPRs = 0;

    try {
      // Get repositories for this organization
      const repos = await repositories.findByOrgId(orgId);
      const repoIds = repos.map(repo => repo.id);

      // Get all pull requests for these repositories
      const { data: prs, error: prError } = await supabase
        .from('pull_requests')
        .select('id, created_at, merged_at')
        .in('repo_id', repoIds);

      if (prError) throw prError;

      // For each PR, find time to first review and time to merge
      for (const pr of prs) {
        // Time to first review
        const { data: reviews, error: reviewError } = await supabase
          .from('review_requests')
          .select('requested_at, completed_at')
          .eq('pr_id', pr.id)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: true });

        if (reviewError) throw reviewError;

        if (reviews && reviews.length > 0) {
          const prCreatedAt = new Date(pr.created_at);
          const firstReviewAt = new Date(reviews[0].completed_at);
          const hoursToFirstReview = (firstReviewAt - prCreatedAt) / (1000 * 60 * 60);
          
          avgTimeToFirstReview += hoursToFirstReview;
          totalPRsWithReviews++;
        }

        // Time to merge
        if (pr.merged_at) {
          const prCreatedAt = new Date(pr.created_at);
          const mergedAt = new Date(pr.merged_at);
          const hoursToMerge = (mergedAt - prCreatedAt) / (1000 * 60 * 60);
          
          avgTimeToMerge += hoursToMerge;
          totalMergedPRs++;
        }
      }

      if (totalPRsWithReviews > 0) {
        avgTimeToFirstReview = avgTimeToFirstReview / totalPRsWithReviews;
      }

      if (totalMergedPRs > 0) {
        avgTimeToMerge = avgTimeToMerge / totalMergedPRs;
      }

    } catch (error) {
      console.error("Error calculating time metrics:", error);
      // We'll still return default values if calculation fails
    }
    
    return {
      avg_hours_to_first_review: avgTimeToFirstReview,
      avg_hours_to_merge: avgTimeToMerge
    };
  },
  
  /**
   * Get weekly PR activity
   * @param {string[]} repoIds - Repository IDs
   * @returns {Promise<Object[]>} Weekly activity
   */
  async getWeeklyActivity(repoIds) {
    // Get weekly PR activity for the last 12 weeks
    const twelvWeeksAgo = new Date();
    twelvWeeksAgo.setDate(twelvWeeksAgo.getDate() - 12 * 7);
    
    const { data: weeklyPRs, error } = await supabase
      .from('pull_requests')
      .select('id, status, created_at, merged_at, closed_at')
      .in('repo_id', repoIds)
      .gte('created_at', twelvWeeksAgo.toISOString());
    
    if (error) throw error;
    
    // Group weekly activity
    const weekMap = {};
    
    // Initialize weeks
    for (let i = 0; i < 12; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      d.setHours(0, 0, 0, 0);
      
      // Get start of the week (Sunday)
      const day = d.getDay();
      const diff = d.getDate() - day;
      const startOfWeek = new Date(d.setDate(diff));
      
      const weekKey = startOfWeek.toISOString().split('T')[0];
      
      weekMap[weekKey] = {
        week: weekKey,
        opened: 0,
        merged: 0,
        closed: 0
      };
    }
    
    // Populate with data
    weeklyPRs.forEach(pr => {
      // Get the week key for various dates
      const getWeekKey = (dateStr) => {
        if (!dateStr) return null;
        
        const d = new Date(dateStr);
        d.setHours(0, 0, 0, 0);
        
        const day = d.getDay();
        const diff = d.getDate() - day;
        const startOfWeek = new Date(d.setDate(diff));
        
        return startOfWeek.toISOString().split('T')[0];
      };
      
      const createdWeek = getWeekKey(pr.created_at);
      const mergedWeek = getWeekKey(pr.merged_at);
      const closedWeek = getWeekKey(pr.closed_at);
      
      // Increment corresponding counters
      if (createdWeek && weekMap[createdWeek]) {
        weekMap[createdWeek].opened++;
      }
      
      if (mergedWeek && weekMap[mergedWeek]) {
        weekMap[mergedWeek].merged++;
      }
      
      if (closedWeek && weekMap[closedWeek] && !pr.merged_at) {
        weekMap[closedWeek].closed++;
      }
    });
    
    // Convert to array and sort by week
    return Object.values(weekMap).sort((a, b) => 
      new Date(a.week).getTime() - new Date(b.week).getTime()
    );
  },
  
/**
 * Get standup dashboard data
 * @param {string} orgId - Organization ID
 * @param {string} period - Time period (daily, weekly, monthly)
 * @param {string|null} repoId - Repository ID filter
 * @param {string|null} teamId - Team ID filter
 * @returns {Promise<Object>} Standup dashboard data
 */
async getStandupData(orgId, period = 'daily', repoId = null, teamId = null) {
  // Calculate start date based on period
  const startDate = new Date();
  
  if (period === 'daily') {
    // Yesterday
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    // Last 7 days
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    // Last 30 days
    startDate.setDate(startDate.getDate() - 30);
    startDate.setHours(0, 0, 0, 0);
  }
  
  // Get repositories for this organization
  let repoIds = [];
  
  if (repoId) {
    // Check if repository belongs to organization
    const repo = await repositories.findById(repoId);
    
    if (repo && repo.org_id === orgId) {
      repoIds = [repoId];
    } else {
      throw new ApiError(404, 'Repository not found');
    }
  } else {
    const repos = await repositories.findByOrgId(orgId);
    repoIds = repos.map(repo => repo.id);
  }
  
  if (repoIds.length === 0) {
    return {
      stats: {
        opened: 0,
        merged: 0,
        closed: 0,
        reviews_completed: 0,
        reviews_pending: 0,
        avg_review_time_hours: 0
      },
      activePRs: [],
      discussionPoints: []
    };
  }
  
  // Get team members if a team filter is applied
  let teamMemberIds = null;
  if (teamId) {
    const { data: team, error } = await supabase
      .from('teams')
      .select('member_ids')
      .eq('org_id', orgId)
      .eq('id', teamId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError(404, 'Team not found');
      }
      throw error;
    }
    
    teamMemberIds = team.member_ids;
  }
  
  // Get stats for the period
  const stats = await this.getStandupStats(repoIds, startDate, teamMemberIds);
  
  // Get active PRs
  const activePRs = await this.getActivePRs(repoIds, orgId, startDate, teamMemberIds);
  
  // Get discussion points - skip for now, would need a new table
  const discussionPoints = [];
  
  return {
    stats,
    activePRs,
    discussionPoints
  };
},
  
  /**
 * Get standup stats with team filtering
 * @param {string[]} repoIds - Repository IDs
 * @param {Date} startDate - Start date for stats
 * @param {string[]|null} teamMemberIds - Team member IDs for filtering
 * @returns {Promise<Object>} Standup stats
 */
async getStandupStats(repoIds, startDate, teamMemberIds = null) {
  // Get PRs created in period
  let createdPRsQuery = supabase
    .from('pull_requests')
    .select('id')
    .in('repo_id', repoIds)
    .gte('created_at', startDate.toISOString());
  
  // Filter by team members if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    createdPRsQuery = createdPRsQuery.in('author_id', teamMemberIds);
  }
  
  const { data: createdPRs, error: createdError } = await createdPRsQuery;
  
  if (createdError) throw createdError;
  
  // Get PRs merged in period
  let mergedPRsQuery = supabase
    .from('pull_requests')
    .select('id')
    .in('repo_id', repoIds)
    .eq('status', 'merged')
    .gte('merged_at', startDate.toISOString());
  
  // Filter by team members if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    mergedPRsQuery = mergedPRsQuery.in('author_id', teamMemberIds);
  }
  
  const { data: mergedPRs, error: mergedError } = await mergedPRsQuery;
  
  if (mergedError) throw mergedError;
  
  // Get PRs closed in period
  let closedPRsQuery = supabase
    .from('pull_requests')
    .select('id')
    .in('repo_id', repoIds)
    .eq('status', 'closed')
    .gte('closed_at', startDate.toISOString());
  
  // Filter by team members if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    closedPRsQuery = closedPRsQuery.in('author_id', teamMemberIds);
  }
  
  const { data: closedPRs, error: closedError } = await closedPRsQuery;
  
  if (closedError) throw closedError;
  
  // Get all PR IDs for review queries
  let prQuery = supabase
    .from('pull_requests')
    .select('id')
    .in('repo_id', repoIds);
  
  // Filter by team members if we're looking at PRs created by team members
  if (teamMemberIds && teamMemberIds.length > 0) {
    prQuery = prQuery.in('author_id', teamMemberIds);
  }
  
  const { data: prIds, error: prIdsError } = await prQuery;
  
  if (prIdsError) throw prIdsError;
  
  // If no PRs found, return zeros
  if (prIds.length === 0) {
    return {
      opened: 0,
      merged: 0,
      closed: 0,
      reviews_completed: 0,
      reviews_pending: 0,
      avg_review_time_hours: 0
    };
  }
  
  // Get completed reviews
  let completedReviewsQuery = supabase
    .from('review_requests')
    .select('id, requested_at, completed_at')
    .in('pr_id', prIds.map(pr => pr.id))
    .not('status', 'eq', 'pending')
    .gte('completed_at', startDate.toISOString());
  
  // Filter by team members as reviewers if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    completedReviewsQuery = completedReviewsQuery.in('reviewer_id', teamMemberIds);
  }
  
  const { data: completedReviews, error: reviewError } = await completedReviewsQuery;
  
  if (reviewError) throw reviewError;
  
  // Get pending reviews
  let pendingReviewsQuery = supabase
    .from('review_requests')
    .select('id')
    .in('pr_id', prIds.map(pr => pr.id))
    .eq('status', 'pending');
  
  // Filter by team members as reviewers if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    pendingReviewsQuery = pendingReviewsQuery.in('reviewer_id', teamMemberIds);
  }
  
  const { data: pendingReviews, error: pendingError } = await pendingReviewsQuery;
  
  if (pendingError) throw pendingError;
  
  // Calculate average review time
  let totalReviewTimeHours = 0;
  
  completedReviews.forEach(review => {
    const requestedAt = new Date(review.requested_at);
    const completedAt = new Date(review.completed_at);
    
    const reviewTimeHours = (completedAt.getTime() - requestedAt.getTime()) / (1000 * 60 * 60);
    totalReviewTimeHours += reviewTimeHours;
  });
  
  const avgReviewTimeHours = completedReviews.length > 0 
    ? totalReviewTimeHours / completedReviews.length 
    : 0;
  
  return {
    opened: createdPRs.length,
    merged: mergedPRs.length,
    closed: closedPRs.length,
    reviews_completed: completedReviews.length,
    reviews_pending: pendingReviews.length,
    avg_review_time_hours: avgReviewTimeHours
  };
},
  

/**
 * Get active PRs with team filtering
 * @param {string[]} repoIds - Repository IDs
 * @param {string} orgId - Organization ID
 * @param {Date} startDate - Start date for activity
 * @param {string[]|null} teamMemberIds - Team member IDs for filtering
 * @returns {Promise<Object[]>} Active PRs
 */
async getActivePRs(repoIds, orgId, startDate, teamMemberIds = null) {
  // Get all open PRs with recent activity
  let activePRsQuery = supabase
    .from('pull_requests')
    .select(`
      id,
      title,
      github_pr_number,
      status,
      created_at,
      updated_at,
      repo_id,
      author_id
    `)
    .in('repo_id', repoIds)
    .eq('status', 'open')
    .or(`updated_at.gte.${startDate.toISOString()},created_at.gte.${startDate.toISOString()}`)
    .order('updated_at', { ascending: false });
  
  // Filter by team members as authors if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    activePRsQuery = activePRsQuery.in('author_id', teamMemberIds);
  }
  
  const { data: activePRsData, error } = await activePRsQuery;
  
  if (error) throw error;
  
  // Get all needed repositories and users for active PRs
  const repositoryMap = {};
  const userMap = {};
  
  // Pre-fetch repositories
  const allRepos = await repositories.findByOrgId(orgId);
  allRepos.forEach(repo => {
    repositoryMap[repo.id] = repo;
  });
  
  // Get unique user IDs
  const userIds = new Set();
  activePRsData.forEach(pr => {
    userIds.add(pr.author_id);
  });
  
  // Pre-fetch users
  for (const userId of userIds) {
    const user = await users.findById(userId);
    userMap[userId] = user;
  }
  
  // Enrich PR data with repository and author details
  const activePRPromises = activePRsData.map(async (pr) => {
    // Get repository details
    const repo = repositoryMap[pr.repo_id];
    
    // Get author details
    const author = userMap[pr.author_id];
    
    // Use the updated getReviewRequests method with team member filtering
    const reviewersData = await pullRequests.getReviewRequests(pr.id, teamMemberIds);
    
    const reviewers = reviewersData.map(rr => {
      const reviewer = rr.reviewer;
      return {
        name: reviewer.github_username || 'Unknown',
        github_username: reviewer.github_username,
        status: rr.status,
        avatar_url: reviewer?.avatar_url
      };
    });
    
    return {
      id: pr.id,
      title: pr.title,
      github_pr_number: pr.github_pr_number,
      status: pr.status,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      github_repo_name: repo?.github_repo_name || 'Unknown',
      author_name: author?.name || author?.github_username || 'Unknown',
      author_username: author?.github_username || 'Unknown',
      author_avatar:author?.avatar_url || '',
      reviewers
    };
  });
  
  return Promise.all(activePRPromises);
},

  // Analytics and Collaboration Dashboard Service Methods
// To be added to the dashboardService object

/**
 * Get analytics dashboard data with team filtering
 * @param {string} orgId - Organization ID
 * @param {string} period - Time period (daily, weekly, monthly)
 * @param {string|null} repoId - Repository ID filter
 * @param {string|null} teamId - Team ID filter
 * @returns {Promise<Object>} Analytics dashboard data
 */
async getAnalyticsData(orgId, period = 'monthly', repoId = null, teamId = null) {
  // Calculate start date based on period
  const startDate = new Date();
  
  if (period === 'daily') {
    // Yesterday
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    // Last 7 days
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    // Last 30 days
    startDate.setDate(startDate.getDate() - 30);
    startDate.setHours(0, 0, 0, 0);
  }
  
  // Get repositories for this organization
  let repoIds = [];
  let repos = [];
  
  if (repoId) {
    // Check if repository belongs to organization
    const repo = await repositories.findById(repoId);
    
    if (repo && repo.org_id === orgId) {
      repoIds = [repoId];
      repos = [repo];
    } else {
      throw new ApiError(404, 'Repository not found');
    }
  } else {
    repos = await repositories.findByOrgId(orgId);
    repoIds = repos.map(repo => repo.id);
  }
  
  if (repoIds.length === 0) {
    return {
      repositoryBreakdown: [],
      prActivity: [],
      platformEngagement: [],
      reviewFulfillment: {
        total: 0,
        completed: 0,
        pending: 0,
        avg_completion_time: 0
      }
    };
  }
  
  // Get team members if a team filter is applied
  let teamMemberIds = null;
  if (teamId) {
    const { data: team, error } = await supabase
      .from('teams')
      .select('member_ids')
      .eq('org_id', orgId)
      .eq('id', teamId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError(404, 'Team not found');
      }
      throw error;
    }
    
    teamMemberIds = team.member_ids;
  }
  
  // Get repository breakdown (PR distribution by repository)
  const repositoryBreakdown = await Promise.all(
    repos.map(async (repo) => {
      let prQuery = supabase
        .from('pull_requests')
        .select('status')
        .eq('repo_id', repo.id)
        .gte('updated_at', startDate.toISOString());
      
      // Filter by team members if provided
      if (teamMemberIds && teamMemberIds.length > 0) {
        prQuery = prQuery.in('author_id', teamMemberIds);
      }
      
      const { data, error } = await prQuery;
      
      if (error) throw error;
      
      const activity = {
        github_repo_name: repo.github_repo_name,
        open_prs: 0,
        merged_prs: 0,
        closed_prs: 0,
        total_prs: data.length
      };
      
      // Group by status in memory
      data.forEach(item => {
        if (item.status === 'open') activity.open_prs++;
        if (item.status === 'merged') activity.merged_prs++;
        if (item.status === 'closed') activity.closed_prs++;
      });
      
      return activity;
    })
  );
  
  // Get PR activity by period
  let prActivityQuery = supabase
    .from('pull_requests')
    .select('status, created_at')
    .in('repo_id', repoIds)
    .gte('created_at', startDate.toISOString());
  
  // Filter by team members if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    prActivityQuery = prActivityQuery.in('author_id', teamMemberIds);
  }
  
  const { data: prActivity, error: prActivityError } = await prActivityQuery;
  
  if (prActivityError) throw prActivityError;

  // Process PR activity in memory
  const processedPrActivity = prActivity.reduce((acc, pr) => {
    const date = pr.created_at.split('T')[0];
    if (!acc[date]) {
      acc[date] = { week: date, opened: 0, merged: 0, closed: 0 };
    }
    if (pr.status === 'open') acc[date].opened++;
    if (pr.status === 'merged') acc[date].merged++;
    if (pr.status === 'closed') acc[date].closed++;
    return acc;
  }, {});

  // Convert to array format and sort by date
  const prActivityArray = Object.values(processedPrActivity).sort((a, b) => 
    new Date(a.week).getTime() - new Date(b.week).getTime()
  );

  // Get platform engagement (GitHub vs. Slack comments)
  const platformEngagement = await this.getPlatformEngagement(repoIds, startDate, teamMemberIds);
  
  // Get review fulfillment metrics
  const reviewFulfillment = await this.getReviewFulfillment(repoIds, startDate, teamMemberIds);
  
  return {
    repositoryBreakdown,
    prActivity: prActivityArray,
    platformEngagement,
    reviewFulfillment
  };
},
  
  /**
   * Get PR activity grouped by time period
   * @param {string[]} repoIds - Repository IDs
   * @param {string} period - Time period (daily, weekly, monthly)
   * @param {Date} startDate - Start date for the period
   * @returns {Promise<Object[]>} PR activity by time slices
   */
  async getPRActivityByPeriod(repoIds, period, startDate) {
    const endDate = new Date();
    const timeSlices = [];
    
    // Create time slices based on period
    if (period === 'daily') {
      // Last 24 hours in 2-hour increments
      for (let i = 0; i < 12; i++) {
        const sliceDate = new Date(endDate);
        sliceDate.setHours(sliceDate.getHours() - (i * 2));
        timeSlices.push({
          start: new Date(sliceDate.setMinutes(0, 0, 0)),
          label: sliceDate.toISOString().split('T')[0] + 'T' + 
                sliceDate.getHours().toString().padStart(2, '0') + ':00:00Z'
        });
      }
    } else if (period === 'weekly') {
      // Last 7 days
      for (let i = 0; i < 7; i++) {
        const sliceDate = new Date(endDate);
        sliceDate.setDate(sliceDate.getDate() - i);
        sliceDate.setHours(0, 0, 0, 0);
        timeSlices.push({
          start: sliceDate,
          label: sliceDate.toISOString().split('T')[0]
        });
      }
    } else {
      // Last 4 weeks
      for (let i = 0; i < 4; i++) {
        const sliceDate = new Date(endDate);
        sliceDate.setDate(sliceDate.getDate() - (i * 7));
        
        // Get start of the week (Sunday)
        const day = sliceDate.getDay();
        const diff = sliceDate.getDate() - day;
        const startOfWeek = new Date(sliceDate.setDate(diff));
        startOfWeek.setHours(0, 0, 0, 0);
        
        timeSlices.push({
          start: startOfWeek,
          label: startOfWeek.toISOString().split('T')[0]
        });
      }
    }
    
    // Reverse to get chronological order
    timeSlices.reverse();
    
    // Get all PRs in the period
    const { data: periodPRs, error } = await supabase
      .from('pull_requests')
      .select('id, status, created_at, merged_at, closed_at, updated_at')
      .in('repo_id', repoIds)
      .gte('updated_at', startDate.toISOString());
    
    if (error) throw error;
    
    // Group by time slice
    const prActivity = timeSlices.map(slice => {
      const nextSliceIndex = timeSlices.indexOf(slice) + 1;
      const nextSlice = nextSliceIndex < timeSlices.length ? timeSlices[nextSliceIndex] : null;
      
      let sliceEnd = nextSlice ? nextSlice.start : new Date();
      
      const opened = periodPRs.filter(pr => {
        const createdAt = new Date(pr.created_at);
        return createdAt >= slice.start && createdAt < sliceEnd;
      }).length;
      
      const merged = periodPRs.filter(pr => {
        if (!pr.merged_at) return false;
        const mergedAt = new Date(pr.merged_at);
        return mergedAt >= slice.start && mergedAt < sliceEnd;
      }).length;
      
      const closed = periodPRs.filter(pr => {
        if (!pr.closed_at || pr.merged_at) return false; // Exclude merged PRs
        const closedAt = new Date(pr.closed_at);
        return closedAt >= slice.start && closedAt < sliceEnd;
      }).length;
      
      return {
        week: slice.label, // Use consistent key regardless of period
        opened,
        merged,
        closed
      };
    });
    
    return prActivity;
  },
  
   /* Get platform engagement with team filtering
  * @param {string[]} repoIds - Repository IDs
  * @param {Date} startDate - Start date for the period
  * @param {string[]|null} teamMemberIds - Team member IDs for filtering
  * @returns {Promise<Object[]>} Platform engagement metrics
  */
async getPlatformEngagement(repoIds, startDate, teamMemberIds = null) {
  // Get PR IDs first
  let prQuery = supabase
    .from('pull_requests')
    .select('id')
    .in('repo_id', repoIds);
  
  // Filter by team members if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    prQuery = prQuery.in('author_id', teamMemberIds);
  }
  
  const { data: prIds, error: prIdsError } = await prQuery;

  if (prIdsError) throw prIdsError;
  
  // If no PRs, return zeros
  if (prIds.length === 0) {
    return [
      { source: 'github', comment_count: 0 },
      { source: 'slack', comment_count: 0 }
    ];
  }
  
  // Get comments
  let commentsQuery = supabase
    .from('comments')
    .select('source')
    .in('pr_id', prIds.map(pr => pr.id))
    .gte('created_at', startDate.toISOString());
  
  // Filter by team members if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    commentsQuery = commentsQuery.in('user_id', teamMemberIds);
  }
  
  const { data: comments, error } = await commentsQuery;
  
  if (error) throw error;
  
  // Count occurrences of each source
  const sourceCount = {
    'github': 0,
    'slack': 0
  };
  
  comments.forEach(item => {
    if (item.source in sourceCount) {
      sourceCount[item.source]++;
    }
  });
  
  // Format the output
  const platformEngagement = [
    { source: 'github', comment_count: sourceCount['github'] },
    { source: 'slack', comment_count: sourceCount['slack'] }
  ];
  
  return platformEngagement;
},
  
  /**
   * Get review fulfillment metrics
   * @param {string[]} repoIds - Repository IDs
   * @param {Date} startDate - Start date for the period
   * @returns {Promise<Object>} Review fulfillment metrics
   */
async getReviewFulfillment(repoIds, startDate, teamMemberIds = null) {
  // Get PR IDs first
  let prQuery = supabase
    .from('pull_requests')
    .select('id')
    .in('repo_id', repoIds);
  
  // Filter by team members if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    prQuery = prQuery.in('author_id', teamMemberIds);
  }
  
  const { data: prIds, error: prIdsError } = await prQuery;

  if (prIdsError) throw prIdsError;
  
  // If no PRs, return zeros
  if (prIds.length === 0) {
    return {
      total: 0,
      completed: 0,
      pending: 0,
      avg_completion_time: 0
    };
  }

  // Get all review requests
  let reviewsQuery = supabase
    .from('review_requests')
    .select('id, status, requested_at, completed_at')
    .in('pr_id', prIds.map(pr => pr.id))
    .gte('requested_at', startDate.toISOString());
  
  // Filter by team members as reviewers if provided
  if (teamMemberIds && teamMemberIds.length > 0) {
    reviewsQuery = reviewsQuery.in('reviewer_id', teamMemberIds);
  }
  
  const { data: allReviews, error } = await reviewsQuery;
  
  if (error) throw error;
  
  const completedReviews = allReviews.filter(r => r.status !== 'pending');
  const pendingReviews = allReviews.filter(r => r.status === 'pending');
  
  // Calculate average completion time
  let totalCompletionTime = 0;
  
  completedReviews.forEach(review => {
    if (review.completed_at) {
      const requestedAt = new Date(review.requested_at);
      const completedAt = new Date(review.completed_at);
      const completionTimeHours = (completedAt - requestedAt) / (1000 * 60 * 60);
      totalCompletionTime += completionTimeHours;
    }
  });
  
  const avgCompletionTime = completedReviews.length > 0
    ? totalCompletionTime / completedReviews.length
    : 0;
  
  return {
    total: allReviews.length,
    completed: completedReviews.length,
    pending: pendingReviews.length,
    avg_completion_time: avgCompletionTime
  };
},
  
  /**
 * Get team collaboration data with team filtering
 * @param {string} orgId - Organization ID
 * @param {string} period - Time period (daily, weekly, monthly)
 * @param {string|null} repoId - Repository ID filter
 * @param {string|null} teamId - Team ID filter
 * @returns {Promise<Object>} Collaboration dashboard data
 */
async getCollaborationData(orgId, period = 'monthly', repoId = null, teamId = null) {
  // Calculate start date based on period
  const startDate = new Date();
  
  if (period === 'daily') {
    // Yesterday
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    // Last 7 days
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    // Last 30 days
    startDate.setDate(startDate.getDate() - 30);
    startDate.setHours(0, 0, 0, 0);
  }
  
  // Get repositories for this organization
  let repoIds = [];
  
  if (repoId) {
    // Check if repository belongs to organization
    const repo = await repositories.findById(repoId);
    
    if (repo && repo.org_id === orgId) {
      repoIds = [repoId];
    } else {
      throw new ApiError(404, 'Repository not found');
    }
  } else {
    const repos = await repositories.findByOrgId(orgId);
    repoIds = repos.map(repo => repo.id);
  }
  
  if (repoIds.length === 0) {
    return {
      reviewerNetwork: [],
      teamMembers: [],
      teamEngagement: []
    };
  }
  
  // Get team members if a team filter is applied
  let teamMemberIds = null;
  if (teamId) {
    const { data: team, error } = await supabase
      .from('teams')
      .select('member_ids')
      .eq('org_id', orgId)
      .eq('id', teamId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError(404, 'Team not found');
      }
      throw error;
    }
    
    teamMemberIds = team.member_ids;
  }
  
  // Get all organization members
  let teamMembers = await users.findByOrgId(orgId);
  
  // Filter team members if a team filter is applied
  if (teamMemberIds && teamMemberIds.length > 0) {
    teamMembers = teamMembers.filter(member => teamMemberIds.includes(member.id));
  }

  console.log('team members in collaboration data: ', teamMembers)
  
  // Get reviewer network (who reviews whose code)
  const reviewerNetwork = await this.getReviewerNetwork(repoIds, teamMembers, startDate, teamMemberIds);
  
  // Get team member performance metrics
  const teamMemberPerformance = await this.getTeamMemberPerformance(repoIds, teamMembers, startDate);
  
  // Get team member engagement (GitHub vs. Slack activity)
  const teamEngagement = await this.getTeamEngagement(repoIds, teamMembers, startDate);
  
  return {
    reviewerNetwork,
    teamMembers: teamMemberPerformance,
    teamEngagement
  };
},
  
  /**
 * Get reviewer network (who reviews whose code)
 * @param {string[]} repoIds - Repository IDs
 * @param {Object[]} teamMembers - Team members
 * @param {Date} startDate - Start date for the period
 * @param {string[]|null} teamMemberIds - Team member IDs for filtering
 * @returns {Promise<Object[]>} Reviewer network data
 */
async getReviewerNetwork(repoIds, teamMembers, startDate, teamMemberIds = null) {
  // Create a map of user IDs to usernames
  const userMap = {};
  teamMembers.forEach(user => {
    userMap[user.id] = user.github_username || user.name;
  });
  
  // Get all pull requests, filtered by team members if provided
  let prQuery = supabase
    .from('pull_requests')
    .select('id, author_id')
    .in('repo_id', repoIds)
    .gte('created_at', startDate.toISOString());
    
  // If team members filter is applied, only show PRs authored by team members
  if (teamMemberIds && teamMemberIds.length > 0) {
    prQuery = prQuery.in('author_id', teamMemberIds);
  }
  
  const { data: prs, error: prError } = await prQuery;
  
  if (prError) throw prError;
  
  // For each PR, get its review requests
  const reviewConnections = [];
  
  for (const pr of prs) {
    // Query setup for review requests
    let reviewQuery = supabase
      .from('review_requests')
      .select('reviewer_id, status')
      .eq('pr_id', pr.id);
    
    // If team members filter is applied, only include reviews by team members
    if (teamMemberIds && teamMemberIds.length > 0) {
      reviewQuery = reviewQuery.in('reviewer_id', teamMemberIds);
    }
    
    const { data: reviews, error: reviewError } = await reviewQuery;
    
    if (reviewError) throw reviewError;
    
    // Only count completed reviews
    const completedReviews = reviews.filter(review => review.status !== 'pending');
    
    completedReviews.forEach(review => {
      const authorName = userMap[pr.author_id] || 'Unknown';
      const reviewerName = userMap[review.reviewer_id] || 'Unknown';
      
      // Find existing connection or create new one
      const existingConnection = reviewConnections.find(
        conn => conn.author === authorName && conn.reviewer === reviewerName
      );
      
      if (existingConnection) {
        existingConnection.review_count++;
      } else {
        reviewConnections.push({
          author: authorName,
          reviewer: reviewerName,
          review_count: 1
        });
      }
    });
  }
  
  return reviewConnections;
},
  
  /**
 * Get team member performance metrics
 * @param {string[]} repoIds - Repository IDs
 * @param {Object[]} teamMembers - Team members
 * @param {Date} startDate - Start date for the period
 * @returns {Promise<Object[]>} Team member performance data
 */
async getTeamMemberPerformance(repoIds, teamMembers, startDate) {
  return Promise.all(teamMembers.map(async (member) => {
    // Get PRs authored by this team member
    const { data: authoredPRs, error: prError } = await supabase
      .from('pull_requests')
      .select('id, status, created_at, merged_at')
      .in('repo_id', repoIds)
      .eq('author_id', member.id)
      .gte('created_at', startDate.toISOString());
    
    if (prError) throw prError;

    // Get PR IDs first
    const { data: prIds, error: prIdsError } = await supabase
      .from('pull_requests')
      .select('id')
      .in('repo_id', repoIds);

    if (prIdsError) throw prIdsError;
    
    // Get reviews assigned to this team member
    const { data: assignedReviews, error: reviewError } = await supabase
      .from('review_requests')
      .select('id, status, requested_at, completed_at')
      .in('pr_id', prIds.map(pr => pr.id))
      .eq('reviewer_id', member.id)
      .gte('requested_at', startDate.toISOString());
    
    if (reviewError) throw reviewError;
    
    const completedReviews = assignedReviews.filter(r => r.status !== 'pending');
    
    // Calculate average review time
    let totalReviewTime = 0;
    let reviewsWithTime = 0;
    
    completedReviews.forEach(review => {
      if (review.completed_at && review.requested_at) {
        const requestedAt = new Date(review.requested_at).getTime();
        const completedAt = new Date(review.completed_at).getTime();
        
        const reviewTimeHours = (completedAt - requestedAt) / (1000 * 60 * 60);
        totalReviewTime += reviewTimeHours;
        reviewsWithTime++;
      }
    });
    
    const avgReviewTime = reviewsWithTime > 0 ? totalReviewTime / reviewsWithTime : 0;
    
    return {
      name: member.name || member.github_username,
      github_username: member.github_username,
      authored_prs: authoredPRs.length,
      open_prs: authoredPRs.filter(pr => pr.status === 'open').length,
      merged_prs: authoredPRs.filter(pr => pr.status === 'merged').length,
      reviews_assigned: assignedReviews.length,
      reviews_completed: completedReviews.length,
      avg_review_time_hours: avgReviewTime,
      avatar_url: member.avatar_url
    };
  }));
},

  
  /**
   * Get team engagement (GitHub vs. Slack activity)
   * @param {string[]} repoIds - Repository IDs
   * @param {Object[]} teamMembers - Team members
   * @param {Date} startDate - Start date for the period
   * @returns {Promise<Object[]>} Team engagement data
   */
  async getTeamEngagement(repoIds, teamMembers, startDate) {
    // Get PR IDs first
    const { data: prIds, error: prIdsError } = await supabase
      .from('pull_requests')
      .select('id')
      .in('repo_id', repoIds);

    if (prIdsError) throw prIdsError;
    
    // If no PRs, return default data
    if (prIds.length === 0) {
      return teamMembers.map(member => ({
        name: member.name || member.github_username,
        github_comments: 0,
        slack_comments: 0,
        avatar_url: `https://i.pravatar.cc/150?u=${member.github_username}`
      }));
    }

    return Promise.all(teamMembers.map(async (member) => {
      // Get comments by source
      const { data: commentsBySource, error } = await supabase.rpc('count_comments_by_source', {
        user_id_param: member.id,
        pr_ids_param: prIds.map(pr => pr.id),
        start_date_param: startDate.toISOString()
      });
      
      if (error) {
        console.error('Error counting comments:', error);
        // Fallback if RPC function fails or doesn't exist
        const { data: comments, error: fallbackError } = await supabase
          .from('comments')
          .select('source')
          .in('pr_id', prIds.map(pr => pr.id))
          .eq('user_id', member.id)
          .gte('created_at', startDate.toISOString());
        
        if (fallbackError) throw fallbackError;
        
        // Count manually
        const githubComments = comments.filter(c => c.source === 'github').length;
        const slackComments = comments.filter(c => c.source === 'slack').length;
        
        return {
          name: member.name || member.github_username,
          github_comments: githubComments,
          slack_comments: slackComments,
          avatar_url: `https://i.pravatar.cc/150?u=${member.github_username}`
        };
      }
      
      // Extract counts from RPC result
      const result = Array.isArray(commentsBySource) ? commentsBySource[0] : commentsBySource;
      
      return {
        name: member.name || member.github_username,
        github_comments: result?.github_count || 0,
        slack_comments: result?.slack_count || 0,
        avatar_url: `https://i.pravatar.cc/150?u=${member.github_username}`
      };
    }));
  },

  /**
   * Get all teams for an organization
   * @param {string} orgId - Organization ID
   * @returns {Promise<Array>} Teams
   */
  async getTeams(orgId) {
    try {
      // Get all teams for this organization
      const { data: teams, error } = await supabase
        .from('teams')
        .select('*')
        .eq('org_id', orgId)
        .order('name');
      
      if (error) throw error;
      
      // For each team, fetch its members
      const teamsWithMembers = await Promise.all(
        teams.map(async (team) => {
          const members = await this.getTeamMembers(orgId, team.id);
          
          return {
            ...team,
            members
          };
        })
      );
      
      return teamsWithMembers;
    } catch (error) {
      console.error('Error fetching teams:', error);
      throw error;
    }
  },

  /**
   * Get a specific team by ID
   * @param {string} orgId - Organization ID
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} Team
   */
  async getTeamById(orgId, teamId) {
    try {
      // Get team details
      const { data: team, error } = await supabase
        .from('teams')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', teamId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          throw new ApiError(404, 'Team not found');
        }
        throw error;
      }
      
      // Get team members
      const members = await this.getTeamMembers(orgId, teamId);
      
      return {
        ...team,
        members
      };
    } catch (error) {
      console.error('Error fetching team:', error);
      throw error;
    }
  },

  /**
   * Get members of a specific team
   * @param {string} orgId - Organization ID
   * @param {string} teamId - Team ID
   * @returns {Promise<Array>} Team members
   */
  async getTeamMembers(orgId, teamId) {
    try {
      // First, get the team to verify it exists and belongs to this org
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('member_ids')
        .eq('org_id', orgId)
        .eq('id', teamId)
        .single();
      
      if (teamError) {
        if (teamError.code === 'PGRST116') {
          throw new ApiError(404, 'Team not found');
        }
        throw teamError;
      }
      
      // If the team has no members, return an empty array
      if (!team.member_ids || team.member_ids.length === 0) {
        return [];
      }
      
      // Fetch the users that are members of this team
      const { data: members, error: membersError } = await supabase
        .from('users')
        .select('id, name, email, github_username, is_admin, slack_user_id')
        .in('id', team.member_ids)
        .eq('org_id', orgId);
      
      if (membersError) throw membersError;
      
      // Enhance member data with connection status
      const enhancedMembers = members.map(member => ({
        ...member,
        github_connected: !!member.github_username,
        slack_connected: !!member.slack_user_id
      }));
      
      return enhancedMembers;
    } catch (error) {
      console.error('Error fetching team members:', error);
      throw error;
    }
  },

  /**
   * Get all organization members
   * @param {string} orgId - Organization ID
   * @returns {Promise<Array>} Organization members
   */
  async getOrgMembers(orgId) {
    try {
      // Fetch all users for this organization
      const { data: members, error } = await supabase
        .from('users')
        .select('id, name, email, github_username, is_admin, slack_user_id')
        .eq('org_id', orgId);
      
      if (error) throw error;
      
      // Enhance member data with connection status
      const enhancedMembers = members.map(member => ({
        ...member,
        github_connected: !!member.github_username,
        slack_connected: !!member.slack_user_id
      }));
      
      return enhancedMembers;
    } catch (error) {
      console.error('Error fetching organization members:', error);
      throw error;
    }
  },

  /**
   * Create a new team
   * @param {string} orgId - Organization ID
   * @param {string} name - Team name
   * @param {Array} memberIds - Member IDs
   * @returns {Promise<Object>} Created team
   */
  async createTeam(orgId, name, memberIds) {
    try {
      // Verify all member IDs belong to this organization
      if (memberIds.length > 0) {
        const { data: orgUsers, error: orgUsersError } = await supabase
          .from('users')
          .select('id')
          .eq('org_id', orgId)
          .in('id', memberIds);
        
        if (orgUsersError) throw orgUsersError;
        
        // Check if any member IDs are invalid
        const validMemberIds = orgUsers.map(user => user.id);
        const invalidMemberIds = memberIds.filter(id => !validMemberIds.includes(id));
        
        if (invalidMemberIds.length > 0) {
          throw new ApiError(400, `Invalid member IDs: ${invalidMemberIds.join(', ')}`);
        }
      }
      
      // Create the team
      const { data, error } = await supabase
        .from('teams')
        .insert([
          { 
            org_id: orgId, 
            name, 
            member_ids: memberIds 
          }
        ])
        .select()
        .single();
      
      if (error) throw error;
      
      // Get team members
      const members = await this.getTeamMembers(orgId, data.id);
      
      return {
        ...data,
        members
      };
    } catch (error) {
      console.error('Error creating team:', error);
      throw error;
    }
  },

  /**
   * Update an existing team
   * @param {string} orgId - Organization ID
   * @param {string} teamId - Team ID
   * @param {string} name - Team name
   * @param {Array} memberIds - Member IDs
   * @returns {Promise<Object>} Updated team
   */
  async updateTeam(orgId, teamId, name, memberIds) {
    try {
      // First, verify the team exists and belongs to this org
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', teamId)
        .single();
      
      if (teamError) {
        if (teamError.code === 'PGRST116') {
          throw new ApiError(404, 'Team not found');
        }
        throw teamError;
      }
      
      // Verify all member IDs belong to this organization
      if (memberIds.length > 0) {
        const { data: orgUsers, error: orgUsersError } = await supabase
          .from('users')
          .select('id')
          .eq('org_id', orgId)
          .in('id', memberIds);
        
        if (orgUsersError) throw orgUsersError;
        
        // Check if any member IDs are invalid
        const validMemberIds = orgUsers.map(user => user.id);
        const invalidMemberIds = memberIds.filter(id => !validMemberIds.includes(id));
        
        if (invalidMemberIds.length > 0) {
          throw new ApiError(400, `Invalid member IDs: ${invalidMemberIds.join(', ')}`);
        }
      }
      
      // Update the team
      const { data, error } = await supabase
        .from('teams')
        .update({ name, member_ids: memberIds })
        .eq('id', teamId)
        .eq('org_id', orgId)
        .select()
        .single();
      
      if (error) throw error;
      
      // Get team members
      const members = await this.getTeamMembers(orgId, data.id);
      
      return {
        ...data,
        members
      };
    } catch (error) {
      console.error('Error updating team:', error);
      throw error;
    }
  },

  /**
   * Delete a team
   * @param {string} orgId - Organization ID
   * @param {string} teamId - Team ID
   * @returns {Promise<void>}
   */
  async deleteTeam(orgId, teamId) {
    try {
      // First, verify the team exists and belongs to this org
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('id')
        .eq('org_id', orgId)
        .eq('id', teamId)
        .single();
      
      if (teamError) {
        if (teamError.code === 'PGRST116') {
          throw new ApiError(404, 'Team not found');
        }
        throw teamError;
      }
      
      // Delete the team
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', teamId)
        .eq('org_id', orgId);
      
      if (error) throw error;
    } catch (error) {
      console.error('Error deleting team:', error);
      throw error;
    }
  }
};

module.exports = dashboardService;
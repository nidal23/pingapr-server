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
      .eq('repo_id', repoIds)
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
            avatar_url: `https://i.pravatar.cc/150?u=${reviewer.github_username}`
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
      .eq('repo_id', repoIds);
    
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
        .eq('repo_id', repoIds);

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
      .eq('repo_id', repoIds)
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
   * @returns {Promise<Object>} Standup dashboard data
   */
  async getStandupData(orgId, period = 'daily', repoId = null) {
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
    
    // Get stats for the period
    const stats = await this.getStandupStats(repoIds, startDate);
    
    // Get active PRs
    const activePRs = await this.getActivePRs(repoIds, orgId, startDate);
    
    // Get discussion points - skip for now, would need a new table
    const discussionPoints = [];
    
    return {
      stats,
      activePRs,
      discussionPoints
    };
  },
  
  /**
   * Get standup stats
   * @param {string[]} repoIds - Repository IDs
   * @param {Date} startDate - Start date for stats
   * @returns {Promise<Object>} Standup stats
   */
  async getStandupStats(repoIds, startDate) {
    // Get PRs created in period
    const { data: createdPRs, error: createdError } = await supabase
      .from('pull_requests')
      .select('id')
      .eq('repo_id', repoIds)
      .gte('created_at', startDate.toISOString());
    
    if (createdError) throw createdError;
    
    // Get PRs merged in period
    const { data: mergedPRs, error: mergedError } = await supabase
      .from('pull_requests')
      .select('id')
      .eq('repo_id', repoIds)
      .eq('status', 'merged')
      .gte('merged_at', startDate.toISOString());
    
    if (mergedError) throw mergedError;
    
    // Get PRs closed in period
    const { data: closedPRs, error: closedError } = await supabase
      .from('pull_requests')
      .select('id')
      .eq('repo_id', repoIds)
      .eq('status', 'closed')
      .gte('closed_at', startDate.toISOString());
    
    if (closedError) throw closedError;
    
    // Get reviews completed in period
    const { data: prIds, error: prIdsError } = await supabase
      .from('pull_requests')
      .select('id')
      .eq('repo_id', repoIds);

    if (prIdsError) throw prIdsError;

    const { data: completedReviews, error: reviewError } = await supabase
      .from('review_requests')
      .select('id, requested_at, completed_at')
      .in('pr_id', prIds.map(pr => pr.id))
      .not('status', 'eq', 'pending')
      .gte('completed_at', startDate.toISOString());
    
    if (reviewError) throw reviewError;
    
    // Get pending reviews
    const { data: pendingReviews, error: pendingError } = await supabase
      .from('review_requests')
      .select('id')
      .in('pr_id', prIds.map(pr => pr.id))
      .eq('status', 'pending');
    
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
   * Get active PRs (open PRs with activity in the period)
   * @param {string[]} repoIds - Repository IDs
   * @param {string} orgId - Organization ID
   * @param {Date} startDate - Start date for activity
   * @returns {Promise<Object[]>} Active PRs
   */
  async getActivePRs(repoIds, orgId, startDate) {
    // Get all open PRs with recent activity
    const { data: activePRsData, error } = await supabase
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
      .eq('repo_id', repoIds)
      .eq('status', 'open')
      .or(`updated_at.gte.${startDate.toISOString()},created_at.gte.${startDate.toISOString()}`)
      .order('updated_at', { ascending: false });
    
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
      
      // Get reviewers
      const reviewersData = await pullRequests.getReviewRequests(pr.id);
      
      const reviewers = reviewersData.map(rr => {
        const reviewer = rr.reviewer;
        return {
          name: reviewer.github_username || 'Unknown',
          github_username: reviewer.github_username,
          status: rr.status,
          avatar_url: `https://i.pravatar.cc/150?u=${reviewer.github_username}`
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
        reviewers
      };
    });
    
    return Promise.all(activePRPromises);
  },

  // Analytics and Collaboration Dashboard Service Methods
// To be added to the dashboardService object

/**
 * Get analytics dashboard data
 * @param {string} orgId - Organization ID
 * @param {string} period - Time period (daily, weekly, monthly)
 * @param {string|null} repoId - Repository ID filter
 * @returns {Promise<Object>} Analytics dashboard data
 */
async getAnalyticsData(orgId, period = 'monthly', repoId = null) {
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
    
    // Get repository breakdown (PR distribution by repository)
    const repositoryBreakdown = await Promise.all(
      repos.map(async (repo) => {
        const { data, error } = await supabase
          .from('pull_requests')
          .select('status')
          .eq('repo_id', repo.id)
          .gte('updated_at', startDate.toISOString());
        
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
    const { data: prActivity, error: prActivityError } = await supabase
      .from('pull_requests')
      .select('status, created_at')
      .eq('repo_id', repoIds)
      .gte('created_at', startDate.toISOString());
    
    if (prActivityError) throw prActivityError;

    // Process PR activity in memory
    const processedPrActivity = prActivity.reduce((acc, pr) => {
      const date = pr.created_at.split('T')[0];
      if (!acc[date]) {
        acc[date] = { opened: 0, merged: 0, closed: 0 };
      }
      if (pr.status === 'open') acc[date].opened++;
      if (pr.status === 'merged') acc[date].merged++;
      if (pr.status === 'closed') acc[date].closed++;
      return acc;
    }, {});

    // Convert to array format
    const prActivityArray = Object.entries(processedPrActivity).map(([date, counts]) => ({
      date,
      ...counts
    }));

    // Get platform engagement (GitHub vs. Slack comments)
    const platformEngagement = await this.getPlatformEngagement(repoIds, startDate);
    
    // Get review fulfillment metrics
    const reviewFulfillment = await this.getReviewFulfillment(repoIds, startDate);
    
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
      .eq('repo_id', repoIds)
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
  
  /**
   * Get platform engagement (GitHub vs. Slack comments)
   * @param {string[]} repoIds - Repository IDs
   * @param {Date} startDate - Start date for the period
   * @returns {Promise<Object[]>} Platform engagement metrics
   */
  async getPlatformEngagement(repoIds, startDate) {
    // Get PR IDs first
    const { data: prIds, error: prIdsError } = await supabase
      .from('pull_requests')
      .select('id')
      .eq('repo_id', repoIds);

    if (prIdsError) throw prIdsError;

    // Get comments grouped by source
    const { data: commentCounts, error } = await supabase
      .from('comments')
      .select('source')
      .in('pr_id', prIds.map(pr => pr.id))
      .gte('created_at', startDate.toISOString());
    
    if (error) throw error;
    
    const platformEngagement = [
      { source: 'github', comment_count: 0 },
      { source: 'slack', comment_count: 0 }
    ];
    
    commentCounts.forEach(item => {
      const count = parseInt(item.count);
      
      if (item.source === 'github') {
        platformEngagement[0].comment_count = count;
      } else if (item.source === 'slack') {
        platformEngagement[1].comment_count = count;
      }
    });
    
    return platformEngagement;
  },
  
  /**
   * Get review fulfillment metrics
   * @param {string[]} repoIds - Repository IDs
   * @param {Date} startDate - Start date for the period
   * @returns {Promise<Object>} Review fulfillment metrics
   */
  async getReviewFulfillment(repoIds, startDate) {
    // Get PR IDs first
    const { data: prIds, error: prIdsError } = await supabase
      .from('pull_requests')
      .select('id')
      .eq('repo_id', repoIds);

    if (prIdsError) throw prIdsError;

    // Get all review requests
    const { data: allReviews, error } = await supabase
      .from('review_requests')
      .select('id, status, requested_at, completed_at')
      .in('pr_id', prIds.map(pr => pr.id))
      .gte('requested_at', startDate.toISOString());
    
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
   * Get team collaboration data
   * @param {string} orgId - Organization ID
   * @param {string} period - Time period (daily, weekly, monthly)
   * @param {string|null} repoId - Repository ID filter
   * @returns {Promise<Object>} Collaboration dashboard data
   */
  async getCollaborationData(orgId, period = 'monthly', repoId = null) {
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
    
    // Get all organization members
    const teamMembers = await users.findByOrgId(orgId);
    
    // Get reviewer network (who reviews whose code)
    const reviewerNetwork = await this.getReviewerNetwork(repoIds, teamMembers, startDate);
    
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
   * @returns {Promise<Object[]>} Reviewer network data
   */
  async getReviewerNetwork(repoIds, teamMembers, startDate) {
    // Create a map of user IDs to usernames
    const userMap = {};
    teamMembers.forEach(user => {
      userMap[user.id] = user.github_username || user.name;
    });
    
    // Get all pull requests
    const { data: prs, error: prError } = await supabase
      .from('pull_requests')
      .select('id, author_id')
      .eq('repo_id', repoIds)
      .gte('created_at', startDate.toISOString());
    
    if (prError) throw prError;
    
    // For each PR, get its review requests
    const reviewConnections = [];
    
    for (const pr of prs) {
      const { data: reviews, error: reviewError } = await supabase
        .from('review_requests')
        .select('reviewer_id, status')
        .eq('pr_id', pr.id);
      
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
        .eq('repo_id', repoIds)
        .eq('author_id', member.id)
        .gte('created_at', startDate.toISOString());
      
      if (prError) throw prError;

      // Get PR IDs first
      const { data: prIds, error: prIdsError } = await supabase
        .from('pull_requests')
        .select('id')
        .eq('repo_id', repoIds);

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
        avatar_url: `https://i.pravatar.cc/150?u=${member.github_username}`
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
      .eq('repo_id', repoIds);

    if (prIdsError) throw prIdsError;

    return Promise.all(teamMembers.map(async (member) => {
      // Get comments grouped by source
      const { data: commentCounts, error } = await supabase
        .from('comments')
        .select('source')
        .in('pr_id', prIds.map(pr => pr.id))
        .eq('user_id', member.id)
        .gte('created_at', startDate.toISOString());
      
      if (error) throw error;
      
      let githubComments = 0;
      let slackComments = 0;
      
      commentCounts.forEach(item => {
        const count = parseInt(item.count);
        
        if (item.source === 'github') {
          githubComments = count;
        } else if (item.source === 'slack') {
          slackComments = count;
        }
      });
      
      return {
        name: member.name || member.github_username,
        github_comments: githubComments,
        slack_comments: slackComments,
        avatar_url: `https://i.pravatar.cc/150?u=${member.github_username}`
      };
    }));
  }
};

module.exports = dashboardService;
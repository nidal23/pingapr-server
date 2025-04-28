/**
 * Supabase database functions
 * Wrapper functions for common database operations
 */
const { supabase, getOrgSupabaseClient } = require('./client');

/**
 * Organization functions
 */
const organizations = {
  /**
   * Find organization by ID
   * @param {string} id - Organization UUID
   * @returns {Promise<Object>} Organization data
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Check if user is admin for organization
   * @param {string} orgId - Organization UUID
   * @param {string} userId - User UUID
   * @returns {Promise<boolean>} True if user is admin
   */
  async isUserAdmin(orgId, userId) {
    const { data: org, error } = await supabase
      .from('organizations')
      .select('admin_users')
      .eq('id', orgId)
      .single();
    
    if (error) throw error;
    
    // Check if user ID is in admin_users array
    return org.admin_users.includes(userId);
  },

  /**
   * Add user to admin_users array
   * @param {string} orgId - Organization UUID
   * @param {string} userId - User UUID to add as admin
   * @returns {Promise<Object>} Updated organization
   */
  async addAdminUser(orgId, userId) {
    const { data: org } = await this.findById(orgId);
    const adminUsers = [...(org.admin_users || [])];
    
    if (!adminUsers.includes(userId)) {
      adminUsers.push(userId);
    }
    
    return this.update(orgId, { admin_users: adminUsers });
  },


  /**
   * Remove user from admin_users array
   * @param {string} orgId - Organization UUID
   * @param {string} userId - User UUID to remove as admin
   * @returns {Promise<Object>} Updated organization
   */
  async removeAdminUser(orgId, userId) {
    const { data: org } = await this.findById(orgId);
    const adminUsers = [...(org.admin_users || [])].filter(id => id !== userId);
    
    return this.update(orgId, { admin_users: adminUsers });
  },
  
  /**
   * Find organization by GitHub org ID
   * @param {string} githubOrgId - GitHub organization ID
   * @returns {Promise<Object>} Organization data
   */
  async findByGithubOrgId(githubOrgId) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('github_org_id', githubOrgId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "no rows returned"
    return data;
  },
  
  /**
   * Find organization by Slack workspace ID
   * @param {string} slackWorkspaceId - Slack workspace ID
   * @returns {Promise<Object>} Organization data
   */
  async findBySlackWorkspaceId(slackWorkspaceId) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('slack_workspace_id', slackWorkspaceId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
  
  /**
   * Create a new organization
   * @param {Object} organization - Organization data
   * @returns {Promise<Object>} Created organization
   */
  async create(organization) {
    const { data, error } = await supabase
      .from('organizations')
      .insert(organization)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update an organization
   * @param {string} id - Organization UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated organization
   */
  async update(id, updates) {
    const { data, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update organization settings
   * @param {string} id - Organization UUID
   * @param {Object} settings - Settings object
   * @returns {Promise<Object>} Updated organization
   */
  async updateSettings(id, settings) {
    const { data: org } = await this.findById(id);
    const updatedSettings = { ...org.settings, ...settings };
    
    return this.update(id, { settings: updatedSettings });
  }
};

/**
 * Repository functions
 */
const repositories = {
  /**
   * Find repository by ID
   * @param {string} id - Repository UUID
   * @returns {Promise<Object>} Repository data
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('repositories')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Find repository by GitHub repo ID and org ID
   * @param {string} orgId - Organization UUID
   * @param {string} githubRepoId - GitHub repository ID
   * @returns {Promise<Object>} Repository data
   */
  async findByGithubRepoId(orgId, githubRepoId) {
    const { data, error } = await supabase
      .from('repositories')
      .select('*')
      .eq('org_id', orgId)
      .eq('github_repo_id', githubRepoId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
  
  /**
   * Find all repositories for an organization
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Array>} List of repositories
   */
  async findByOrgId(orgId) {
    const { data, error } = await supabase
      .from('repositories')
      .select('*')
      .eq('org_id', orgId);
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Create a new repository
   * @param {Object} repository - Repository data
   * @returns {Promise<Object>} Created repository
   */
  async create(repository) {
    const { data, error } = await supabase
      .from('repositories')
      .insert(repository)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update a repository
   * @param {string} id - Repository UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated repository
   */
  async update(id, updates) {
    const { data, error } = await supabase
      .from('repositories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Toggle repository active status
   * @param {string} id - Repository UUID
   * @returns {Promise<Object>} Updated repository
   */
  async toggleActive(id) {
    const { data: repo } = await this.findById(id);
    return this.update(id, { is_active: !repo.is_active });
  }
};

/**
 * User functions
 */
const users = {
  /**
   * Find user by ID
   * @param {string} id - User UUID
   * @returns {Promise<Object>} User data
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Find user by GitHub username and org ID
   * @param {string} orgId - Organization UUID
   * @param {string} githubUsername - GitHub username
   * @returns {Promise<Object>} User data
   */
  async findByGithubUsername(orgId, githubUsername) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('org_id', orgId)
      .eq('github_username', githubUsername)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
  
  /**
   * Find user by Slack user ID and org ID
   * @param {string} orgId - Organization UUID
   * @param {string} slackUserId - Slack user ID
   * @returns {Promise<Object>} User data
   */
  async findBySlackUserId(orgId, slackUserId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('org_id', orgId)
      .eq('slack_user_id', slackUserId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },


  /**
   * Set admin status for a user
   * @param {string} id - User UUID
   * @param {boolean} isAdmin - Admin status
   * @returns {Promise<Object>} Updated user
   */
  async setAdminStatus(id, isAdmin) {
    const { data: user } = await this.findById(id);
    
    // Update user admin status
    const updatedUser = await this.update(id, { is_admin: isAdmin });
    
    // Also update the organization's admin_users array
    if (isAdmin) {
      await organizations.addAdminUser(user.org_id, id);
    } else {
      await organizations.removeAdminUser(user.org_id, id);
    }
    
    return updatedUser;
  },
  
  /**
   * Find all users for an organization
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Array>} List of users
   */
  async findByOrgId(orgId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('org_id', orgId);
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Create a new user
   * @param {Object} user - User data
   * @returns {Promise<Object>} Created user
   */
  async create(user) {
    const { data, error } = await supabase
      .from('users')
      .insert(user)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update a user
   * @param {string} id - User UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated user
   */
  async update(id, updates) {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update or create a user
   * @param {string} orgId - Organization UUID
   * @param {string} githubUsername - GitHub username
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created or updated user
   */
  async upsertByGithubUsername(orgId, githubUsername, userData) {
    const existingUser = await this.findByGithubUsername(orgId, githubUsername);
    
    if (existingUser) {
      return this.update(existingUser.id, userData);
    } else {
      return this.create({
        org_id: orgId,
        github_username: githubUsername,
        ...userData
      });
    }
  },

   /**
   * Find user by ID with Slack token
   * @param {string} userId - User UUID
   * @returns {Promise<Object>} User data with slack token
   */
   async findWithSlackToken(slackUserId) {
    const { data, error } = await supabase
      .from('users')
      .select('slack_user_id, slack_user_token, org_id')
      .eq('slack_user_id', slackUserId)
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Clear a user's Slack token (for revoked tokens)
   * @param {string} userId - User UUID
   * @returns {Promise<boolean>} Success status
   */
  async clearSlackToken(userId) {
    const { error } = await supabase
      .from('users')
      .update({
        slack_user_token: null,
        slack_token_expires_at: null
      })
      .eq('id', userId);
    
    if (error) throw error;
    return true;
  }
};

/**
 * Pull request functions
 */
const pullRequests = {
  /**
   * Find pull request by ID
   * @param {string} id - Pull request UUID
   * @returns {Promise<Object>} Pull request data
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        *,
        repository:repo_id(id, github_repo_name, org_id),
        author:author_id(id, github_username, slack_user_id)
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Find pull request by GitHub PR ID and repo ID
   * @param {string} repoId - Repository UUID
   * @param {string} githubPrId - GitHub pull request ID
   * @returns {Promise<Object>} Pull request data
   */
  async findByGithubPrId(repoId, githubPrId) {
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        *,
        repository:repo_id(id, github_repo_name, org_id),
        author:author_id(id, github_username, slack_user_id)
      `)
      .eq('repo_id', repoId)
      .eq('github_pr_id', githubPrId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
  
  /**
   * Find pull request by GitHub PR number and repo ID
   * @param {string} repoId - Repository UUID
   * @param {number} prNumber - GitHub pull request number
   * @returns {Promise<Object>} Pull request data
   */
  async findByPrNumber(repoId, prNumber) {
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        *,
        repository:repo_id(id, github_repo_name, org_id),
        author:author_id(id, github_username, slack_user_id)
      `)
      .eq('repo_id', repoId)
      .eq('github_pr_number', prNumber)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
  
  /**
   * Create a new pull request
   * @param {Object} pullRequest - Pull request data
   * @returns {Promise<Object>} Created pull request
   */
  async create(pullRequest) {
    const { data, error } = await supabase
      .from('pull_requests')
      .insert(pullRequest)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update a pull request
   * @param {string} id - Pull request UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated pull request
   */
  async update(id, updates) {
    const { data, error } = await supabase
      .from('pull_requests')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Get all review requests for a pull request
   * @param {string} prId - Pull request UUID
   * @returns {Promise<Array>} List of review requests
   */
  async getReviewRequests(prId) {
    const { data, error } = await supabase
      .from('review_requests')
      .select(`
        *,
        reviewer:reviewer_id(id, github_username, slack_user_id)
      `)
      .eq('pr_id', prId);
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Check for stale PRs that need reminders
   * @returns {Promise<Array>} List of PRs needing reminders
   */
  async checkStalePRs() {
    const { data, error } = await supabase
      .rpc('check_stale_prs');
    
    if (error) throw error;
    return data || [];
  },
  
  /**
   * Mark a PR as reminded
   * @param {string} prId - Pull request UUID
   * @returns {Promise<void>}
   */
  async markAsReminded(prId) {
    const { error } = await supabase
      .rpc('mark_pr_reminded', { pr_id_param: prId });
    
    if (error) throw error;
  },


    /**
   * Find all open pull requests for a repository
   * @param {string} repoId - Repository UUID
   * @returns {Promise<Array>} List of open pull requests with repository and author data
   */
  async findOpenPRsByRepoId(repoId) {
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        id,
        title,
        github_pr_number,
        slack_channel_id,
        status,
        repository:repo_id(id, github_repo_name),
        author:author_id(id, github_username, slack_user_id)
      `)
      .eq('repo_id', repoId)
      .eq('status', 'open');
    
    if (error) throw error;
    return data;
  },

  
  async findOpenPRsByAuthor(userId) {
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        id,
        title,
        status,
        github_pr_number,
        slack_channel_id,
        repository:repo_id(id, github_repo_name)
      `)
      .eq('author_id', userId)
      .eq('status', 'open');
    
    if (error) throw error;
    return data;
  },

  /**
   * Find all open pull requests across multiple repositories
   * @param {Array<string>} repoIds - Array of repository UUIDs
   * @returns {Promise<Array>} List of open pull requests with repository and author data
   */
  async findOpenPRsByRepoIds(repoIds) {
    if (!repoIds || repoIds.length === 0) return [];
    
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        id,
        title,
        github_pr_number,
        slack_channel_id,
        status,
        repository:repo_id(id, github_repo_name),
        author:author_id(id, github_username, slack_user_id)
      `)
      .in('repo_id', repoIds)
      .eq('status', 'open');
    
    if (error) throw error;
    return data;
  },

  /**
 * Find all open pull requests authored by a user
 * @param {string} userId - User UUID
 * @returns {Promise<Array>} List of open pull requests authored by the user
 */
  async findOpenPRsByAuthor(userId) {
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        id,
        title,
        status,
        github_pr_number,
        slack_channel_id,
        repository:repo_id(id, github_repo_name)
      `)
      .eq('author_id', userId)
      .eq('status', 'open');
    
    if (error) throw error;
    return data;
  },
  

  /**
   * Find a pull request by Slack channel ID
   * @param {string} channelId - Slack channel ID
   * @returns {Promise<Object>} Pull request data with repository and author
   */
  async findBySlackChannelId(channelId) {
    const { data, error } = await supabase
      .from('pull_requests')
      .select(`
        *,
        repository:repo_id(id, github_repo_name, org_id, github_repo_id),
        author:author_id(id, github_username, slack_user_id)
      `)
      .eq('slack_channel_id', channelId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
  
  /**
   * Check for channels that should be archived
   * @returns {Promise<Array>} List of channels to archive
   */
  async checkChannelsToArchive() {
    const { data, error } = await supabase
      .rpc('check_channel_archival');
    
    if (error) throw error;
    return data || [];
  }
};

/**
 * Review request functions
 */
const reviewRequests = {
  /**
   * Find review request by PR ID and reviewer ID
   * @param {string} prId - Pull request UUID
   * @param {string} reviewerId - Reviewer UUID
   * @returns {Promise<Object>} Review request data
   */
  async findByPrAndReviewer(prId, reviewerId) {
    const { data, error } = await supabase
      .from('review_requests')
      .select('*')
      .eq('pr_id', prId)
      .eq('reviewer_id', reviewerId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
  
  /**
   * Create a new review request
   * @param {Object} reviewRequest - Review request data
   * @returns {Promise<Object>} Created review request
   */
  async create(reviewRequest) {
    const { data, error } = await supabase
      .from('review_requests')
      .insert(reviewRequest)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update a review request
   * @param {string} id - Review request UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated review request
   */
  async update(id, updates) {
    const { data, error } = await supabase
      .from('review_requests')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Update or create a review request
   * @param {string} prId - Pull request UUID
   * @param {string} reviewerId - Reviewer UUID
   * @param {Object} data - Review request data
   * @returns {Promise<Object>} Created or updated review request
   */
  async upsert(prId, reviewerId, data) {
    const existing = await this.findByPrAndReviewer(prId, reviewerId);
    
    if (existing) {
      return this.update(existing.id, data);
    } else {
      return this.create({
        pr_id: prId,
        reviewer_id: reviewerId,
        ...data
      });
    }
  },

  /**
 * Find all open pull requests where a user is a reviewer but not the author
 * @param {string} userId - User UUID
 * @returns {Promise<Array>} List of review requests with pull request data
 */
async findOpenPRsForReviewer(userId) {
  try {
    // First, get all review requests where the user is a reviewer
    const { data, error } = await supabase
      .from('review_requests')
      .select(`
        id,
        status,
        pull_request:pr_id(
          id,
          title,
          status,
          github_pr_number,
          slack_channel_id,
          author_id,
          repository:repo_id(id, github_repo_name),
          author:author_id(id, github_username, slack_user_id)
        )
      `)
      .eq('reviewer_id', userId)
      .eq('pull_request.status', 'open');
    
    if (error) throw error;
    
    // Filter out PRs where the user is also the author
    const filteredData = data.filter(item => 
      item.pull_request && item.pull_request.author_id !== userId
    );
    
    return filteredData;
  } catch (error) {
    console.error('Error in findOpenPRsForReviewer:', error);
    throw error;
  }
}

};

/**
 * Comment functions
 */
const comments = {
  /**
   * Find comment by ID
   * @param {string} id - Comment UUID
   * @returns {Promise<Object>} Comment data
   */
  async findById(id) {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        user:user_id(id, github_username, slack_user_id)
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Find comment by GitHub comment ID and PR ID
   * @param {string} prId - Pull request UUID
   * @param {string} githubCommentId - GitHub comment ID
   * @returns {Promise<Object>} Comment data
   */
  // In your db.comments.js file
  async findByGithubCommentId(prId, githubCommentId) {
    try {
      console.log(`Finding comment by github_comment_id: ${githubCommentId}, prId: ${prId || 'any'}`);
      
      let query = supabase
        .from('comments')
        .select(`
          *,
          user:user_id(id, github_username, slack_user_id)
        `)
        .eq('github_comment_id', githubCommentId);
      
      // Add PR filter only if provided
      if (prId) {
        query = query.eq('pr_id', prId);
      }
      
      const { data, error } = await query.maybeSingle();
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error in findByGithubCommentId:', error);
        throw error;
      }
      
      if (data) {
        console.log(`Found comment with ID: ${data.id}, source: ${data.source || 'unknown'}`);
      } else {
        console.log(`No comment found for github_comment_id: ${githubCommentId}`);
      }
      
      return data;
    } catch (error) {
      console.error('Error finding comment by GitHub comment ID:', error);
      throw error;
    }
  },
  
  /**
   * Find comment by Slack thread timestamp
   * @param {string} threadTs - Slack thread timestamp
   * @returns {Promise<Object>} Comment data
   */
  async findByThreadTs(threadTs) {
    try {
      console.log(`Finding comment by thread_ts: ${threadTs}`);
      
      // First try to find a review summary with this thread_ts
      const { data: reviewSummary, error: reviewError } = await supabase
        .from('comments')
        .select(`
          *,
          pull_request:pr_id(
            *,
            repository:repo_id(*)
          ),
          user:user_id(*)
        `)
        .eq('slack_thread_ts', threadTs)
        .eq('comment_type', 'review_summary')
        .single();
      
      // If we found a review summary, return it
      if (reviewSummary) {
        console.log(`Found review summary comment with ID: ${reviewSummary.id}`);
        return reviewSummary;
      }
      
      // If no review summary, look for any comment with this thread_ts
      // Try to find a comment where slack_message_ts matches the thread_ts
      const { data: messageComment, error: messageError } = await supabase
        .from('comments')
        .select(`
          *,
          pull_request:pr_id(
            *,
            repository:repo_id(*)
          ),
          user:user_id(*)
        `)
        .eq('slack_message_ts', threadTs)
        .single();
      
      if (messageComment) {
        console.log(`Found comment with ID: ${messageComment.id} by slack_message_ts match`);
        return messageComment;
      }
      
      // As a fallback, try to find any comment with this thread_ts
      const { data: anyComment, error: anyError } = await supabase
        .from('comments')
        .select(`
          *,
          pull_request:pr_id(
            *,
            repository:repo_id(*)
          ),
          user:user_id(*)
        `)
        .eq('slack_thread_ts', threadTs)
        .order('created_at', { ascending: false })
        .single();
      
      if (anyComment) {
        console.log(`Found comment with ID: ${anyComment.id} as fallback`);
        return anyComment;
      }
      
      console.log('No comment found for thread timestamp');
      return null;
    } catch (error) {
      console.error('Error finding comment by thread timestamp:', error);
      throw error;
    }
  },


  /**
 * Update or create a comment
 * @param {string} prId - Pull request UUID
 * @param {string} githubCommentId - GitHub comment ID
 * @param {Object} data - Comment data
 * @returns {Promise<Object>} Created or updated comment
 */
async upsert(prId, githubCommentId, data) {
  try {
    const existingComment = await this.findByGithubCommentId(prId, githubCommentId);
    
    if (existingComment) {
      return this.update(existingComment.id, {
        ...data,
        updated_at: new Date().toISOString()
      });
    } else {
      return this.create({
        id: uuidv4(),
        pr_id: prId,
        github_comment_id: githubCommentId,
        ...data
      });
    }
  } catch (error) {
    console.error('Error upserting comment:', error);
    throw error;
  }
},
  

  /**
   * Update a comment
   * @param {string} id - Comment UUID
   * @param {Object} data - Updated comment data
   * @returns {Promise<Object>} Updated comment
   */
  async update(id, data) {
    try {
      console.log(`Updating comment ${id} with data:`, data);
      
      const { data: updatedComment, error } = await supabase
        .from('comments')
        .update({
          ...data,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      return updatedComment;
    } catch (error) {
      console.error('Error updating comment:', error);
      throw error;
    }
  },

  /**
   * Create a new comment
   * @param {Object} comment - Comment data
   * @returns {Promise<Object>} Created comment
   */
  async create(comment) {
    const { data, error } = await supabase
      .from('comments')
      .insert(comment)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  /**
   * Get all comments for a PR
   * @param {string} prId - Pull request UUID
   * @returns {Promise<Array>} List of comments
   */
  async getByPrId(prId) {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        user:user_id(id, github_username, slack_user_id)
      `)
      .eq('pr_id', prId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data;
  }
};

// const githubConnections = {
//     /**
//      * Find connection by organization ID
//      * @param {string} orgId - Organization UUID
//      * @returns {Promise<Object>} GitHub connection data
//      */
//     async findByOrgId(orgId) {
//       const { data, error } = await supabase
//         .from('github_connections')
//         .select('*')
//         .eq('org_id', orgId)
//         .single();
      
//       if (error && error.code !== 'PGRST116') throw error;
//       return data;
//     },
    
//     /**
//      * Create a new GitHub connection
//      * @param {Object} connection - Connection data
//      * @returns {Promise<Object>} Created connection
//      */
//     async create(connection) {
//       const { data, error } = await supabase
//         .from('github_connections')
//         .insert(connection)
//         .select()
//         .single();
      
//       if (error) throw error;
//       return data;
//     },
    
//     /**
//      * Update a GitHub connection
//      * @param {string} id - Connection UUID
//      * @param {Object} updates - Fields to update
//      * @returns {Promise<Object>} Updated connection
//      */
//     async update(id, updates) {
//       const { data, error } = await supabase
//         .from('github_connections')
//         .update(updates)
//         .eq('id', id)
//         .select()
//         .single();
      
//       if (error) throw error;
//       return data;
//     }
//   };


  // const slackConnections = {
  //   /**
  //    * Find connection by organization ID
  //    * @param {string} orgId - Organization UUID
  //    * @returns {Promise<Object>} Slack connection data
  //    */
  //   async findByOrgId(orgId) {
  //       const { data, error } = await supabase
  //         .from('slack_connections')
  //         .select('*')
  //         .eq('org_id', orgId)
  //         .single();
        
  //       if (error && error.code !== 'PGRST116') throw error;
  //       return data;
  //     },
      
  //     /**
  //      * Create a new Slack connection
  //      * @param {Object} connection - Connection data
  //      * @returns {Promise<Object>} Created connection
  //      */
  //     async create(connection) {
  //       const { data, error } = await supabase
  //         .from('slack_connections')
  //         .insert(connection)
  //         .select()
  //         .single();
        
  //       if (error) throw error;
  //       return data;
  //     },
      
  //     /**
  //      * Update a Slack connection
  //      * @param {string} id - Connection UUID
  //      * @param {Object} updates - Fields to update
  //      * @returns {Promise<Object>} Updated connection
  //      */
  //     async update(id, updates) {
  //       const { data, error } = await supabase
  //         .from('slack_connections')
  //         .update(updates)
  //         .eq('id', id)
  //         .select()
  //         .single();
        
  //       if (error) throw error;
  //       return data;
  //     }
  // }

module.exports = {
    organizations,
    repositories,
    users,
    // githubConnections,
    pullRequests,
    reviewRequests,
    comments
};
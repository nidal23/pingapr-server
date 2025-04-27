// src/services/github/api.js

const githubAuth = require('./auth')

/**
 * GitHub API service
 * Handles direct GitHub API interactions
 */

/**
 * Create an Octokit instance
 * @param {string} token - GitHub access token
 * @returns {Promise<Object>} Octokit instance
 */
const createOctokit = async (token) => {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({ auth: token });
};

/**
 * Create a comment on a PR
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @param {string} body - Comment body
 * @returns {Promise<Object>} GitHub API response
 */
const createComment = async (token, repoFullName, prNumber, body) => {
  try {
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    const response = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body
    });
    
    return response.data;
  } catch (error) {
    console.error('Error creating GitHub comment:', error);
    throw error;
  }
};

/**
 * Create a reply to a specific comment
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @param {string} commentId - Comment ID to reply to (may be a special format for reviews)
 * @param {string} body - Reply body
 * @returns {Promise<Object>} GitHub API response
 */
const createCommentReply = async (token, repoFullName, prNumber, commentId, body) => {
    try {
      console.log(`Creating reply to comment: ${commentId} in PR #${prNumber}`);
      
      // If this is a review comment (starts with "review_")
      if (commentId.startsWith('review_')) {
        const reviewId = commentId.replace('review_', '');
        console.log(`Replying to review: ${reviewId}`);
        return await createReviewComment(token, repoFullName, prNumber, reviewId, body);
      }
      
      // Check if this is a line comment (contains only numbers)
      if (/^\d+$/.test(commentId)) {
        console.log(`Replying to line comment: ${commentId}`);
        return await createReviewLineCommentReply(token, repoFullName, prNumber, commentId, body);
      }
      
      // For regular PR comments
      console.log(`Replying to regular PR comment: ${commentId}`);
      return await createComment(
        token, 
        repoFullName, 
        prNumber, 
        `> Re: [comment](https://github.com/${repoFullName}/pull/${prNumber}#issuecomment-${commentId})\n\n${body}`
      );
    } catch (error) {
      console.error('Error replying to GitHub comment:', error);
      throw error;
    }
  };
/**
 * Create a reply to a review
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @param {string} reviewId - Review ID
 * @param {string} body - Reply body
 * @returns {Promise<Object>} GitHub API response
 */
const createReviewComment = async (token, repoFullName, prNumber, reviewId, body) => {
  try {
    // For review comments, we can just create a new PR comment
    // that references the review
    return await createComment(
      token,
      repoFullName,
      prNumber,
      `> Re: [review](https://github.com/${repoFullName}/pull/${prNumber}#pullrequestreview-${reviewId})\n\n${body}`
    );
  } catch (error) {
    console.error('Error replying to GitHub review:', error);
    throw error;
  }
};

/**
 * Update an existing comment
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {string} commentId - Comment ID
 * @param {string} body - Updated comment body
 * @returns {Promise<Object>} GitHub API response
 */
const updateComment = async (token, repoFullName, commentId, body) => {
  try {
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    // Remove any "review_" prefix if present
    const actualCommentId = commentId.startsWith('review_') 
      ? commentId.replace('review_', '') 
      : commentId;
    
    const response = await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: actualCommentId,
      body
    });
    
    return response.data;
  } catch (error) {
    console.error('Error updating GitHub comment:', error);
    throw error;
  }
};

/**
 * Get details of a pull request
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @returns {Promise<Object>} Pull request data
 */
const getPullRequest = async (token, repoFullName, prNumber) => {
  try {
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    const response = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting pull request:', error);
    throw error;
  }
};

/**
 * Refresh GitHub OAuth token
 * @param {string} refreshToken - GitHub refresh token
 * @returns {Promise<Object>} New access token data
 */
const refreshToken = async (refreshToken) => {
  try {
    // Set up the request to GitHub's token endpoint
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    
    // Call GitHub's token endpoint to get a new access token
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`GitHub token refresh error: ${data.error}`);
    }
    
    // Calculate expiry times
    const now = new Date();
    const expiresIn = data.expires_in || 8 * 60 * 60; // Default to 8 hours if not provided
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);
    
    // Parse refresh token expiry
    let refreshTokenExpiresAt = null;
    if (data.refresh_token_expires_in) {
      refreshTokenExpiresAt = new Date(now.getTime() + data.refresh_token_expires_in * 1000);
    }
    
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt.toISOString(),
      refresh_token_expires_at: refreshTokenExpiresAt ? refreshTokenExpiresAt.toISOString() : null
    };
  } catch (error) {
    console.error('Error refreshing GitHub token:', error);
    throw error;
  }
};

/**
 * Get a list of comments on a PR
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @returns {Promise<Array>} Array of comments
 */
const getPullRequestComments = async (token, repoFullName, prNumber) => {
  try {
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    const response = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting PR comments:', error);
    throw error;
  }
};

/**
 * Add reviewers to a PR
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @param {Array<string>} reviewers - Array of GitHub usernames to request reviews from
 * @returns {Promise<Object>} GitHub API response
 */
const requestReviewers = async (token, repoFullName, prNumber, reviewers) => {
  try {
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    const response = await octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: prNumber,
      reviewers
    });
    
    return response.data;
  } catch (error) {
    console.error('Error requesting reviewers:', error);
    throw error;
  }
};

/**
 * Get organization members
 * @param {string} token - GitHub installation token
 * @param {string} org - Organization name
 * @returns {Promise<Array>} Array of organization members
 */
const getOrgMembers = async (token, org) => {
  try {
    const octokit = await createOctokit(token);
    
    const response = await octokit.orgs.listMembers({
      org,
      per_page: 100
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting organization members:', error);
    throw error;
  }
};


/**
 * Get a specific review comment
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} commentId - Comment ID
 * @returns {Promise<Object>} Review comment data
 */
const getReviewComment = async (token, repoFullName, commentId) => {
  try {
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    const { data } = await octokit.pulls.getReviewComment({
      owner,
      repo,
      comment_id: commentId
    });
    
    return data;
  } catch (error) {
    console.error('Error fetching review comment:', error);
    throw error;
  }
};


/**
 * Create a reply to a specific line comment
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @param {string} commentId - Comment ID to reply to
 * @param {string} body - Reply body
 * @returns {Promise<Object>} GitHub API response
 */
const createReviewLineCommentReply = async (token, repoFullName, prNumber, commentId, body) => {
    try {
      console.log(`Creating reply to line comment ${commentId} in PR #${prNumber}`);
      
      const octokit = await createOctokit(token);
      const [owner, repo] = repoFullName.split('/');
      
      // Try to use the createReplyForReviewComment endpoint if available
      try {
        // First check if the comment exists and is a review comment
        const { data: originalComment } = await octokit.pulls.getReviewComment({
          owner,
          repo,
          comment_id: commentId,
        });
        
        console.log(`Original comment found: ${originalComment.id}, path: ${originalComment.path}`);
        
        // Create a reply in the same thread
        const response = await octokit.pulls.createReplyForReviewComment({
          owner,
          repo,
          pull_number: prNumber,
          comment_id: commentId,
          body
        });
        
        return response.data;
      } catch (error) {
        console.error('Error creating direct reply to line comment, falling back to PR comment:', error.message);
        
        // Fallback to creating a regular PR comment with reference
        return await createComment(
          token,
          repoFullName,
          prNumber,
          `> Re: [comment on line](https://github.com/${repoFullName}/pull/${prNumber}#discussion_r${commentId})\n\n${body}`
        );
      }
    } catch (error) {
      console.error('Error replying to GitHub line comment:', error);
      throw error;
    }
  };
  
  

/**
 * Get repositories for an organization
 * @param {string} token - GitHub installation token
 * @param {string} org - Organization name
 * @returns {Promise<Array>} Array of repositories
 */
const getOrgRepos = async (token, org) => {
  try {
    const octokit = await createOctokit(token);
    
    const response = await octokit.repos.listForOrg({
      org,
      per_page: 100
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting organization repos:', error);
    throw error;
  }
};

/**
 * Get comments for a specific review
 * @param {string} orgId - Organization ID
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @param {number} reviewId - Review ID
 * @returns {Promise<Array>} List of review comments
 */
const getReviewComments = async (orgId, repoFullName, prNumber, reviewId) => {
  try {
    // Get token using the new auth method
    const token = await githubAuth.getAccessToken(orgId);
    
    if (!token) {
      console.error('No valid GitHub token available');
      return [];
    }
    
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    const { data } = await octokit.pulls.listCommentsForReview({
      owner,
      repo,
      pull_number: prNumber,
      review_id: reviewId
    });
    
    return data;
  } catch (error) {
    console.error('Error fetching review comments:', error);
    throw error;
  }
};


/**
 * Get a specific review
 * @param {string} token - GitHub access token
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {number} prNumber - PR number
 * @param {number} reviewId - Review ID
 * @returns {Promise<Object>} Review data
 */
const getReview = async (token, repoFullName, prNumber, reviewId) => {
  try {
    const octokit = await createOctokit(token);
    const [owner, repo] = repoFullName.split('/');
    
    const { data } = await octokit.pulls.getReview({
      owner,
      repo,
      pull_number: prNumber,
      review_id: reviewId
    });
    
    return data;
  } catch (error) {
    console.error('Error fetching review:', error);
    throw error;
  }
};

module.exports = {
  createComment,
  createCommentReply,
  updateComment,
  getPullRequest,
  getPullRequestComments,
  requestReviewers,
  getOrgMembers,
  getOrgRepos,
  createReviewLineCommentReply,
  refreshToken,
  getReviewComments,
  getReview,
  getReviewComment
};


// Creating comments on PRs: Allows posting new comments on pull requests.

// Replying to comments: Creates a reply to an existing comment, handling both regular comments and review comments differently.

// Updating comments: Allows editing of existing comments.

// Fetching PR details: Gets information about a specific pull request.

// Fetching PR comments: Retrieves all comments on a pull request.

// Requesting reviewers: Assigns reviewers to a pull request.

// Organization operations: Gets organization members and repositories.
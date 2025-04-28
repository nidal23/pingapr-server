// src/services/slack/commands.js
const axios = require('axios');
const { WebClient } = require('@slack/web-api');
const db = require('../../services/supabase/functions');
const slackMessages = require('./messages');
const githubApi = require('../github/api');
const githubAuth = require('../github/auth');

/**
 * Respond to a Slack command using the response_url
 * @param {string} responseUrl - Slack response URL
 * @param {Object} message - Message object to send
 * @returns {Promise<Object>} Axios response
 */
const respondToCommand = async (responseUrl, message) => {
  try {
    // Set response type to 'in_channel' by default if not specified
    const payload = {
      ...message,
      response_type: message.response_type || 'ephemeral'
    };
    
    // Send the response
    const response = await axios.post(responseUrl, payload);
    return response;
  } catch (error) {
    console.error('Error responding to Slack command:', error);
    throw error;
  }
};

/**
 * Format a list of pull requests for display in Slack
 * @param {Array} prs - Array of pull request objects
 * @returns {Array} Array of Slack blocks
 */
const formatPRList = (prs) => {
  if (!prs || prs.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "No open pull requests found."
        }
      }
    ];
  }
  
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${prs.length} Open Pull Request${prs.length !== 1 ? 's' : ''}`,
        emoji: true
      }
    }
  ];
  
  prs.forEach(pr => {
    const repoFullName = pr.repository.github_repo_name;
    const prNumber = pr.github_pr_number;
    const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
    
    // Format authors and reviewers
    const authorDisplay = pr.author?.slack_user_id 
      ? `<@${pr.author.slack_user_id}>` 
      : (pr.author?.github_username || 'Unknown');
    
    let reviewersText = 'None';
    if (pr.reviewers && pr.reviewers.length > 0) {
      reviewersText = pr.reviewers
        .map(reviewer => reviewer.slack_user_id 
          ? `<@${reviewer.slack_user_id}>` 
          : reviewer.github_username)
        .join(', ');
    }
    
    // Add section for this PR
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${prUrl}|#${prNumber}: ${pr.title}>*\n*Author:* ${authorDisplay}\n*Reviewers:* ${reviewersText}\n*Repository:* ${repoFullName}\n*Channel:* <#${pr.slack_channel_id || 'unknown'}>`
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "View PR",
            emoji: true
          },
          url: prUrl
        }
      },
      {
        type: "divider"
      }
    );
  });
  
  return blocks;
};

/**
 * Get all open PRs for a specific repository
 * @param {string} repoId - Repository ID
 * @returns {Promise<Array>} Array of PR objects
 */
const getOpenPRsForRepo = async (repoId) => {
  try {
    // Use the database function to get open PRs
    const prs = await db.pullRequests.findOpenPRsByRepoId(repoId);
    
    // Fetch reviewers for each PR
    for (const pr of prs) {
      const reviewers = await db.pullRequests.getReviewRequests(pr.id);
      pr.reviewers = reviewers.map(rr => rr.reviewer);
    }
    
    return prs;
  } catch (error) {
    console.error('Error fetching open PRs for repo:', error);
    throw error;
  }
};

/**
 * Get all open PRs across all repositories in an organization
 * @param {string} orgId - Organization ID
 * @returns {Promise<Array>} Array of PR objects
 */
const getAllOpenPRs = async (orgId) => {
  try {
    // Get all active repositories for this org
    const repos = await db.repositories.findByOrgId(orgId);
    const activeRepoIds = repos.filter(r => r.is_active).map(r => r.id);
    
    if (activeRepoIds.length === 0) {
      return [];
    }
    
    // Use the database function to get open PRs across repositories
    const prs = await db.pullRequests.findOpenPRsByRepoIds(activeRepoIds);
    
    // Fetch reviewers for each PR
    for (const pr of prs) {
      const reviewers = await db.pullRequests.getReviewRequests(pr.id);
      pr.reviewers = reviewers.map(rr => rr.reviewer);
    }
    
    return prs;
  } catch (error) {
    console.error('Error fetching all open PRs:', error);
    throw error;
  }
};

/**
 * Handle the /lgtm command to approve a PR
 * @param {Object} org - Organization data
 * @param {Object} user - User data
 * @param {string} channelId - Slack channel ID
 * @param {string} responseUrl - Slack response URL
 * @returns {Promise<void>}
 */
const handleLGTMCommand = async (org, user, channelId, responseUrl) => {
  try {
    // Find the PR associated with this channel using the database function
    const pr = await db.pullRequests.findBySlackChannelId(channelId);
    
    if (!pr) {
      await respondToCommand(responseUrl, {
        text: 'This channel is not associated with any pull request.'
      });
      return;
    }
    
    // Check if user is a requested reviewer
    const reviewRequest = await db.reviewRequests.findByPrAndReviewer(pr.id, user.id);
    
    if (!reviewRequest) {
      await respondToCommand(responseUrl, {
        text: 'You are not a requested reviewer for this PR.'
      });
      return;
    }
    
    // Validate and refresh GitHub token if needed
    const { valid, token, message } = await githubAuth.validateAndRefreshUserToken(user);
    
    if (!valid) {
      await respondToCommand(responseUrl, {
        text: message || 'Your GitHub authentication is invalid. Please reconnect your GitHub account.'
      });
      return;
    }
    
    // Submit the approval review using the GitHub API
    const repoFullName = pr.repository.github_repo_name;
    const prNumber = pr.github_pr_number;
    
    try {
      // Use githubApi to create the review
      const [owner, repo] = repoFullName.split('/');
      
      await githubApi.createPullRequestReview(
        token, // Using the possibly refreshed token
        owner,
        repo,
        prNumber,
        'APPROVE',
        'LGTM! Approved via PingaPR from Slack.'
      );
      
      // Update the review request status
      await db.reviewRequests.update(reviewRequest.id, {
        status: 'approved',
        completed_at: new Date().toISOString()
      });
      
      // Post success message
      await respondToCommand(responseUrl, {
        text: `✅ Success! You've approved PR #${prNumber}: ${pr.title}`
      });
      
      // Also post in the channel
      await slackMessages.sendReviewMessage(
        org.slack_bot_token,
        channelId,
        {
          title: pr.title,
          url: `https://github.com/${repoFullName}/pull/${prNumber}`,
          reviewer: user.github_username,
          reviewerSlackId: user.slack_user_id,
          state: 'approved',
          body: 'LGTM! Approved via PingaPR from Slack.',
          prNumber
        }
      );
    } catch (error) {
      console.error('Error submitting GitHub review:', error);
      await respondToCommand(responseUrl, {
        text: `Error approving PR: ${error.message}`
      });
    }
  } catch (error) {
    console.error('Error handling LGTM command:', error);
    await respondToCommand(responseUrl, {
      text: 'An error occurred while processing your command. Please try again later.'
    });
  }
};

/**
 * Open repository selection modal for /pingapr open command
 * @param {Object} org - Organization data
 * @param {string} userId - Slack user ID
 * @param {string} responseUrl - Slack response URL
 * @param {string} triggerId - Slack trigger ID
 * @returns {Promise<void>}
 */
const openRepoSelectionModal = async (org, userId, responseUrl, triggerId) => {
  try {
    // Get all repositories for the organization
    const repos = await db.repositories.findByOrgId(org.id);
    
    if (!repos || repos.length === 0) {
      await respondToCommand(responseUrl, {
        text: 'No connected repositories found for your organization.'
      });
      return;
    }
    
    // Create a dropdown dialog for repository selection
    const options = repos.map(repo => {
      const repoName = repo.github_repo_name.split('/')[1]; // Extract repo name without org
      return {
        text: {
          type: "plain_text",
          text: repoName,
          emoji: true
        },
        value: repo.id
      };
    });
    
    // Add an "All Repositories" option
    options.unshift({
      text: {
        type: "plain_text",
        text: "All Repositories",
        emoji: true
      },
      value: "all"
    });
    
    // Open a modal for repository selection
    const client = new WebClient(org.slack_bot_token);
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "repo_selection_modal",
        title: {
          type: "plain_text",
          text: "Select Repository",
          emoji: true
        },
        submit: {
          type: "plain_text",
          text: "Submit",
          emoji: true
        },
        close: {
          type: "plain_text",
          text: "Cancel",
          emoji: true
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Select a repository to view open pull requests:"
            }
          },
          {
            type: "input",
            block_id: "repo_selection_block",
            element: {
              type: "static_select",
              placeholder: {
                type: "plain_text",
                text: "Select a repository",
                emoji: true
              },
              options: options,
              action_id: "repo_selection_action"
            },
            label: {
              type: "plain_text",
              text: "Repository",
              emoji: true
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "Select 'All Repositories' to see PRs across all repositories."
              }
            ]
          }
        ],
        private_metadata: JSON.stringify({
          command: "pingapr_open",
          response_url: responseUrl,
          user_id: userId,
          org_id: org.id
        })
      }
    });
  } catch (error) {
    console.error('Error handling open PRs command:', error);
    await respondToCommand(responseUrl, {
      text: 'An error occurred while retrieving repositories. Please try again later.'
    });
  }
};

/**
 * Get user's PRs (both authored and to review) and format them for display
 * @param {Object} org - Organization data
 * @param {Object} user - User data
 * @param {string} responseUrl - Slack response URL
 * @returns {Promise<void>}
 */
const getUserPRsAndRespond = async (org, user, responseUrl) => {
  try {
    // Get PRs authored by the user - using database function
    const authoredPRs = await db.pullRequests.findOpenPRsByAuthor(user.id);
    
    if (!authoredPRs) {
      await respondToCommand(responseUrl, {
        text: 'Error retrieving your PRs. Please try again later.'
      });
      return;
    }
    
    // Get PRs where user is a reviewer - using database function
    const reviewPRs = await db.reviewRequests.findOpenPRsForReviewer(user.id);
    
    if (!reviewPRs) {
      await respondToCommand(responseUrl, {
        text: 'Error retrieving PRs for review. Please try again later.'
      });
      return;
    }
    
    // Format the responses into blocks
    const blocks = formatUserPRsBlocks(authoredPRs, reviewPRs);
    
    // Send the response
    await respondToCommand(responseUrl, {
      blocks,
      text: "Your Pull Requests" // Fallback text
    });
  } catch (error) {
    console.error('Error handling my PRs command:', error);
    await respondToCommand(responseUrl, {
      text: 'An error occurred while retrieving your PRs. Please try again later.'
    });
  }
};

/**
 * Format user's PRs into Slack blocks
 * @param {Array} authoredPRs - PRs authored by the user
 * @param {Array} reviewPRs - PRs where user is a reviewer
 * @returns {Array} Slack blocks
 */
const formatUserPRsBlocks = (authoredPRs, reviewPRs) => {
  // Format authored PRs section
  let authoredBlocks = [];
  if (authoredPRs && authoredPRs.length > 0) {
    authoredBlocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🔍 Your Open Pull Requests",
          emoji: true
        }
      }
    ];
    
    authoredPRs.forEach(pr => {
      const repoFullName = pr.repository.github_repo_name;
      const prNumber = pr.github_pr_number;
      const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
      
      authoredBlocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${prUrl}|#${prNumber}: ${pr.title}>*\n*Repository:* ${repoFullName}\n*Channel:* <#${pr.slack_channel_id}>`
          }
        },
        {
          type: "divider"
        }
      );
    });
  }
  
  // Format review PRs section
  let reviewBlocks = [];
  if (reviewPRs && reviewPRs.length > 0) {
    reviewBlocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "👀 Awaiting Your Review",
          emoji: true
        }
      }
    ];
    
    reviewPRs.forEach(rr => {
      const pr = rr.pull_request;
      if (!pr) return; // Skip if PR data is missing
      
      const repoFullName = pr.repository.github_repo_name;
      const prNumber = pr.github_pr_number;
      const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
      const authorDisplay = pr.author.slack_user_id 
        ? `<@${pr.author.slack_user_id}>` 
        : pr.author.github_username;
      
      // Show review status
      let statusEmoji = "⏳";
      let statusText = "Pending";
      
      if (rr.status === 'approved') {
        statusEmoji = "✅";
        statusText = "Approved";
      } else if (rr.status === 'changes_requested') {
        statusEmoji = "❌";
        statusText = "Changes Requested";
      }
      
      reviewBlocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${prUrl}|#${prNumber}: ${pr.title}>*\n*Author:* ${authorDisplay}\n*Repository:* ${repoFullName}\n*Channel:* <#${pr.slack_channel_id}>\n*Status:* ${statusEmoji} ${statusText}`
          }
        },
        {
          type: "divider"
        }
      );
    });
  }
  
  // Combine blocks
  let blocks = [];
  
  if (authoredBlocks.length > 0) {
    blocks = blocks.concat(authoredBlocks);
  }
  
  if (reviewBlocks.length > 0) {
    blocks = blocks.concat(reviewBlocks);
  }
  
  if (blocks.length === 0) {
    blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "You don't have any open pull requests, and you're not assigned as a reviewer on any open PRs."
        }
      }
    ];
  }
  
  return blocks;
};

module.exports = {
  respondToCommand,
  handleLGTMCommand,
  openRepoSelectionModal,
  getUserPRsAndRespond,
  formatPRList,
  getOpenPRsForRepo,
  getAllOpenPRs,
  WebClient
};
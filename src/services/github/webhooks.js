/**
 * GitHub webhooks service
 * Handles processing of GitHub webhook events
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../supabase/functions');
const slackService = require('../../services/slack/messages');
const slackChannels = require('../../services/slack/channels');
const { formatPrDescription } = require('../../utils/formatting');
const { supabase } = require('../supabase/client');
const githubService = require('./api')
const githubAuth = require('./auth');
/**
 * Handle GitHub ping event
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Result of ping processing
 */
const handlePingEvent = async (payload) => {
  return {
    status: 'success',
    message: 'GitHub webhook connection confirmed'
  };
};

/**
 * Handle GitHub pull request event
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Result of PR event processing
 */
const handlePullRequestEvent = async (payload) => {
  try {
    const { action, repository, organization, pull_request: pr, installation } = payload;
    
    console.log('action in handle pull request event: ', action)
    // Get organization from database
    let org = await db.organizations.findByGithubOrgId(organization?.id || repository.owner.id);
    
    // If organization doesn't exist, we can't process this webhook
    if (!org) {
      console.log(`Organization not found for GitHub org ID: ${organization?.id || repository.owner.id}`);
      return {
        status: 'error',
        message: 'Organization not registered with PingaPR'
      };
    }

    // Update GitHub installation ID if needed
    if (installation && org.github_installation_id !== installation.id.toString()) {
        await db.organizations.update(org.id, {
          github_installation_id: installation.id.toString()
        });
      }
    
    // Find repository in database
    let repo = await db.repositories.findByGithubRepoId(org.id, repository.id);
    
    // If repo doesn't exist yet but has a valid installation, create it
    if (!repo && installation) {
      repo = await db.repositories.create({
        id: uuidv4(),
        org_id: org.id,
        github_repo_id: repository.id.toString(),
        github_repo_name: repository.full_name,
        is_active: true
      });
    }
    
    // If repo doesn't exist or isn't active, ignore the webhook
    if (!repo || !repo.is_active) {
      return {
        status: 'ignored',
        message: 'Repository not tracked or inactive'
      };
    }
    
    // Process based on action
    switch (action) {
      case 'opened':
        return await handlePrOpened(org, repo, pr, payload);
        
      case 'closed':
        return await handlePrClosed(org, repo, pr, payload);
        
      case 'reopened':
        return await handlePrReopened(org, repo, pr, payload);
        
      case 'review_requested':
        return await handlePrReviewRequested(org, repo, pr, payload);
        
      case 'review_request_removed':
        return await handlePrReviewRequestRemoved(org, repo, pr, payload);
        
      case 'synchronize': // PR code was updated
        return await handlePrSynchronize(org, repo, pr, payload);
        
      case 'edited':
        return await handlePrEdited(org, repo, pr, payload);
        
      default:
        return {
          status: 'ignored',
          message: `PR action '${action}' not handled`
        };
    }
  } catch (error) {
    console.error('Error processing pull request event:', error);
    throw error;
  }
};

/**
 * Handle PR opened event
 * @param {Object} org - Organization data
 * @param {Object} repo - Repository data
 * @param {Object} pr - Pull request data from GitHub
 * @param {Object} payload - Full webhook payload
 * @returns {Object} Result of processing
 */
const handlePrOpened = async (org, repo, pr, payload) => {
  try {
    // Find or create the PR author
    const authorUsername = pr.user.login;
    let author = await db.users.findByGithubUsername(org.id, authorUsername);
    
    if (!author) {
      // Create a placeholder user record for the author
      author = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: authorUsername,
        is_admin: false
      });
    }
    
    // Create PR record in database
    const pullRequest = await db.pullRequests.create({
      id: uuidv4(),
      repo_id: repo.id,
      github_pr_id: pr.id.toString(),
      github_pr_number: pr.number,
      title: pr.title,
      description: pr.body || '',
      author_id: author.id,
      status: 'open',
      created_at: new Date(pr.created_at).toISOString(),
      updated_at: new Date(pr.updated_at).toISOString()
    });
    
    // Create Slack channel for the PR
    const channel = await slackChannels.createPrChannel(org, pullRequest, repo);
    
    // Update PR with Slack channel ID
    await db.pullRequests.update(pullRequest.id, {
      slack_channel_id: channel.id
    });
    
    // Update the pullRequest object with the channel ID
    pullRequest.slack_channel_id = channel.id;
    
    // Process requested reviewers and collect their Slack IDs
    const reviewerInfo = [];
    if (pr.requested_reviewers && pr.requested_reviewers.length > 0) {
      for (const reviewer of pr.requested_reviewers) {
        // Process review request and add to database
        await processReviewRequest(org, pullRequest, reviewer.login);
        
        // Find the reviewer in our database to get their Slack ID
        const reviewerUser = await db.users.findByGithubUsername(org.id, reviewer.login);
        
        reviewerInfo.push({
          githubUsername: reviewer.login,
          slackUserId: reviewerUser?.slack_user_id || null
        });
      }
    }
    
    
    // Send PR notification to Slack
    const formattedDescription = formatPrDescription(pr.body || '', 300);
    const message = await slackService.sendPrOpenedMessage(
      org.slack_bot_token,
      channel.id,
      {
        title: pr.title,
        url: pr.html_url,
        author: author,
        repoName: repo.github_repo_name,
        description: formattedDescription,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        labels: pr.labels.map(l => l.name),
        reviewers: reviewerInfo  // Add the reviewers info here
      }
    );
    
    return {
      status: 'success',
      message: 'Pull request opened and notification sent',
      data: {
        pr_id: pullRequest.id,
        channel_id: channel.id
      }
    };
  } catch (error) {
    console.error('Error handling PR opened event:', error);
    throw error;
  }
};

/**
 * Handle PR closed event
 * @param {Object} org - Organization data
 * @param {Object} repo - Repository data
 * @param {Object} pr - Pull request data from GitHub
 * @param {Object} payload - Full webhook payload
 * @returns {Object} Result of processing
 */
const handlePrClosed = async (org, repo, pr, payload) => {
  try {
    // Find PR in database
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Update PR status
    const isMerged = pr.merged || false;
    await db.pullRequests.update(pullRequest.id, {
      status: isMerged ? 'merged' : 'closed',
      merged_at: isMerged ? new Date(pr.merged_at).toISOString() : null,
      closed_at: new Date(pr.closed_at).toISOString()
    });
    
    // Send PR closed notification to Slack
    if (pullRequest.slack_channel_id) {
      await slackService.sendPrClosedMessage(
        org.slack_bot_token,
        pullRequest.slack_channel_id,
        {
          title: pr.title,
          url: pr.html_url,
          merged: isMerged,
          closedBy: payload.sender.login,
          repoName: repo.github_repo_name
        }
      );
      
      // Schedule channel archival based on org settings
      const channelArchiveDays = org.settings?.channel_archive_days || 7;
      
      // We'll let the Supabase function handle archival timing
      // The scheduled job will check for channels to archive
    }
    
    return {
      status: 'success',
      message: `Pull request ${isMerged ? 'merged' : 'closed'} and notification sent`
    };
  } catch (error) {
    console.error('Error handling PR closed event:', error);
    throw error;
  }
};

/**
 * Handle PR reopened event
 * @param {Object} org - Organization data
 * @param {Object} repo - Repository data
 * @param {Object} pr - Pull request data from GitHub
 * @param {Object} payload - Full webhook payload
 * @returns {Object} Result of processing
 */
const handlePrReopened = async (org, repo, pr, payload) => {
  try {
    // Find PR in database
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
    
    if (!pullRequest) {
      // If PR doesn't exist, handle it like a new PR
      return await handlePrOpened(org, repo, pr, payload);
    }
    
    // Update PR status
    await db.pullRequests.update(pullRequest.id, {
      status: 'open',
      merged_at: null,
      closed_at: null,
      updated_at: new Date(pr.updated_at).toISOString()
    });
    
    // If there's no Slack channel, create one
    let channelId = pullRequest.slack_channel_id;
    
    if (!channelId) {
      const channel = await slackChannels.createPrChannel(org, pullRequest, repo);
      channelId = channel.id;
      
      // Update PR with new channel ID
      await db.pullRequests.update(pullRequest.id, {
        slack_channel_id: channelId
      });
    }
    
    // Send PR reopened notification to Slack
    await slackService.sendPrReopenedMessage(
      org.slack_bot_token,
      channelId,
      {
        title: pr.title,
        url: pr.html_url,
        reopenedBy: payload.sender.login,
        repoName: repo.github_repo_name
      }
    );
    
    return {
      status: 'success',
      message: 'Pull request reopened and notification sent'
    };
  } catch (error) {
    console.error('Error handling PR reopened event:', error);
    throw error;
  }
};

/**
 * Handle PR review requested event
 * @param {Object} org - Organization data
 * @param {Object} repo - Repository data
 * @param {Object} pr - Pull request data from GitHub
 * @param {Object} payload - Full webhook payload
 * @returns {Object} Result of processing
 */
const handlePrReviewRequested = async (org, repo, pr, payload) => {
  console.log('handle pr review requested is called during pr opening')
  try {
    // Get requested reviewer
    const requestedReviewer = payload.requested_reviewer?.login;
    
    if (!requestedReviewer) {
      return {
        status: 'error',
        message: 'No reviewer found in payload'
      };
    }
    
    // Find PR in database
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Process review request
    await processReviewRequest(org, pullRequest, requestedReviewer);
    
    return {
      status: 'success',
      message: 'Review request processed'
    };
  } catch (error) {
    console.error('Error handling PR review requested event:', error);
    throw error;
  }
};

/**
 * Handle PR review request removed event
 * @param {Object} org - Organization data
 * @param {Object} repo - Repository data
 * @param {Object} pr - Pull request data from GitHub
 * @param {Object} payload - Full webhook payload
 * @returns {Object} Result of processing
 */
const handlePrReviewRequestRemoved = async (org, repo, pr, payload) => {
  try {
    // Get removed reviewer
    const removedReviewer = payload.requested_reviewer?.login;
    
    if (!removedReviewer) {
      return {
        status: 'error',
        message: 'No reviewer found in payload'
      };
    }
    
    // Find PR in database
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Find the reviewer
    const reviewer = await db.users.findByGithubUsername(org.id, removedReviewer);
    
    if (reviewer) {
      // Find the review request
      const reviewRequest = await db.reviewRequests.findByPrAndReviewer(
        pullRequest.id,
        reviewer.id
      );
      
      if (reviewRequest) {
        // Update review request status
        await db.reviewRequests.update(reviewRequest.id, {
          status: 'removed'
        });
        
        // Notify in Slack if channel exists
        if (pullRequest.slack_channel_id) {
          await slackService.sendReviewRequestRemovedMessage(
            org.slack_bot_token,
            pullRequest.slack_channel_id,
            {
              title: pr.title,
              url: pr.html_url,
              reviewer: removedReviewer,
              removedBy: payload.sender.login
            }
          );
        }
      }
    }
    
    return {
      status: 'success',
      message: 'Review request removal processed'
    };
  } catch (error) {
    console.error('Error handling PR review request removed event:', error);
    throw error;
  }
};

/**
 * Handle PR synchronize event (new commits pushed)
 * @param {Object} org - Organization data
 * @param {Object} repo - Repository data
 * @param {Object} pr - Pull request data from GitHub
 * @param {Object} payload - Full webhook payload
 * @returns {Object} Result of processing
 */
const handlePrSynchronize = async (org, repo, pr, payload) => {
  try {
    // Find PR in database
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Update PR updated timestamp
    await db.pullRequests.update(pullRequest.id, {
      updated_at: new Date(pr.updated_at).toISOString()
    });
    
    // Notify in Slack if channel exists
    if (pullRequest.slack_channel_id) {
      await slackService.sendPrUpdatedMessage(
        org.slack_bot_token,
        pullRequest.slack_channel_id,
        {
          title: pr.title,
          url: pr.html_url,
          updatedBy: pr.user.login,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changed_files
        }
      );
    }
    
    return {
      status: 'success',
      message: 'Pull request update processed'
    };
  } catch (error) {
    console.error('Error handling PR synchronize event:', error);
    throw error;
  }
};

/**
 * Handle PR edited event
 * @param {Object} org - Organization data
 * @param {Object} repo - Repository data
 * @param {Object} pr - Pull request data from GitHub
 * @param {Object} payload - Full webhook payload
 * @returns {Object} Result of processing
 */
const handlePrEdited = async (org, repo, pr, payload) => {
    try {
      // Find PR in database
      const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
      
      if (!pullRequest) {
        return {
          status: 'error',
          message: 'Pull request not found in database'
        };
      }
      
      // Check what was changed
      const changes = payload.changes || {};
      const titleChanged = changes.title !== undefined;
      const bodyChanged = changes.body !== undefined;
      
      if (!titleChanged && !bodyChanged) {
        return {
          status: 'ignored',
          message: 'No relevant changes to process'
        };
      }
      
      // Update PR in database
      const updates = {};
      
      if (titleChanged) {
        updates.title = pr.title;
      }
      
      if (bodyChanged) {
        updates.description = pr.body || '';
      }
      
      await db.pullRequests.update(pullRequest.id, updates);
      
      // Notify in Slack if channel exists
      if (pullRequest.slack_channel_id) {
        await slackService.sendPrEditedMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          {
            title: pr.title,
            url: pr.html_url,
            editedBy: payload.sender.login,
            titleChanged,
            bodyChanged
          }
        );
      }
      
      return {
        status: 'success',
        message: 'Pull request edit processed'
      };
    } catch (error) {
      console.error('Error handling PR edited event:', error);
      throw error;
    }
  };

/**
 * Handle GitHub pull request review event
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Result of processing
 */
const handlePullRequestReviewEvent = async (payload) => {
  try {
    const { action, repository, organization, pull_request: pr, review } = payload;
    
    console.log(`[REVIEW EVENT] Processing review event: ${action} for PR #${pr.number}, review ID: ${review.id}`);
    console.log('review body: ', review.body);
    // Only process initial review submissions, not individual comments
    if (action !== 'submitted') {
      console.log(`[REVIEW EVENT] Ignoring non-submission review action: ${action}`);
      return {
        status: 'ignored',
        message: `Ignoring non-submission review event: ${action}`
      };
    }

    // Get organization from database
    let org = await db.organizations.findByGithubOrgId(organization?.id || repository.owner.id);
    console.log(`[REVIEW EVENT] Found organization: ${org ? org.id : 'not found'}`);
    
    // If organization doesn't exist, we can't process this webhook
    if (!org) {
      return {
        status: 'error',
        message: 'Organization not registered with PingaPR'
      };
    }

    if (!review.body && review.state === 'commented') {
      console.log(`[REVIEW EVENT] Empty review detected (likely just a comment). Review ID: ${review.id}`);
      
      // Check if this review has any comments
      try {
        const reviewComments = await githubService.getReviewComments(
          org.id,
          repository.full_name,
          pr.number,
          review.id
        );
        
        // If this review only has one comment, it's likely just a standalone comment
        // not an actual review, so we should skip it
        if (reviewComments && Array.isArray(reviewComments) && reviewComments.length === 1) {
          console.log(`[REVIEW EVENT] This appears to be a single comment review, skipping to avoid duplication`);
          return {
            status: 'ignored',
            message: 'Empty review with just a single comment, skipping to avoid duplication'
          };
        }
      } catch (error) {
        console.error(`[REVIEW EVENT] Error checking review comments: ${error}`);
        // Continue processing in case of error, but log it
      }
    }
    
    // Check for Slack markers to avoid duplication
    if (review.body && review.body.includes('<!-- SENT_FROM_SLACK -->')) {
      console.log(`[REVIEW EVENT] Review ${review.id} originated from Slack, ignoring webhook`);
      return {
        status: 'ignored',
        message: 'Review originated from Slack, ignoring to prevent duplication'
      };
    }
    
    // Find repository in database
    let repo = await db.repositories.findByGithubRepoId(org.id, repository.id);
    console.log(`[REVIEW EVENT] Found repository: ${repo ? repo.id : 'not found'}`);
    
    // If repo doesn't exist or isn't active, ignore the webhook
    if (!repo || !repo.is_active) {
      return {
        status: 'ignored',
        message: 'Repository not tracked or inactive'
      };
    }
    
    // Find PR in database
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
    console.log(`[REVIEW EVENT] Found PR: ${pullRequest ? pullRequest.id : 'not found'}`);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Check if this review has been processed before
    const commentId = `review_${review.id}`;
    const existingComment = await db.comments.findByGithubCommentId(pullRequest.id, commentId);
    console.log(`[REVIEW EVENT] Existing review comment: ${existingComment ? existingComment.id : 'not found'}`);
    
    if (existingComment) {
      console.log(`[REVIEW EVENT] Review ${review.id} has already been processed, updating instead`);
      
      // Just update the existing comment if needed
      if (review.body && existingComment.content !== review.body) {
        await db.comments.update(existingComment.id, {
          content: review.body,
          updated_at: new Date().toISOString()
        });
        
        // Update in Slack if needed
        if (existingComment.slack_thread_ts) {
          await slackService.updateMessage(
            org.slack_bot_token,
            pullRequest.slack_channel_id,
            existingComment.slack_thread_ts,
            review.body
          );
        }
      }
      
      return {
        status: 'success',
        message: 'Pull request review updated'
      };
    }
    
    // Find the reviewer
    const reviewerUsername = review.user.login;
    let reviewer = await db.users.findByGithubUsername(org.id, reviewerUsername);
    console.log(`[REVIEW EVENT] Found reviewer: ${reviewer ? reviewer.id : 'not found'}`);
    
    if (!reviewer) {
      // Create a placeholder user record
      reviewer = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: reviewerUsername,
        is_admin: false
      });
      console.log(`[REVIEW EVENT] Created new reviewer: ${reviewer.id}`);
    }
    
    // Find or create review request
    const reviewRequest = await db.reviewRequests.findByPrAndReviewer(
      pullRequest.id,
      reviewer.id
    );
    
    // Update review request status based on review state
    const reviewStatus = review.state.toLowerCase();
    console.log(`[REVIEW EVENT] Review status: ${reviewStatus}`);
    
    if (reviewRequest) {
      await db.reviewRequests.update(reviewRequest.id, {
        status: reviewStatus,
        completed_at: ['approved', 'changes_requested'].includes(reviewStatus)
          ? new Date().toISOString()
          : null
      });
      console.log(`[REVIEW EVENT] Updated review request: ${reviewRequest.id}`);
    } else if (['approved', 'changes_requested', 'commented'].includes(reviewStatus)) {
      // Create a new review request if one doesn't exist
      const newReviewRequest = await db.reviewRequests.create({
        id: uuidv4(),
        pr_id: pullRequest.id,
        reviewer_id: reviewer.id,
        status: reviewStatus,
        requested_at: new Date(review.submitted_at || new Date()).toISOString(),
        completed_at: ['approved', 'changes_requested'].includes(reviewStatus)
          ? new Date().toISOString()
          : null
      });
      console.log(`[REVIEW EVENT] Created new review request: ${newReviewRequest.id}`);
    }
    
    // Fetch comments count for this review - we don't need to process them here
    // as they'll be handled by the review_comment webhook
    let commentCount = 0;
    
    try {
      const reviewComments = await githubService.getReviewComments(
        org.id,
        repository.full_name,
        pr.number,
        review.id
      );
      
      if (reviewComments && Array.isArray(reviewComments)) {
        commentCount = reviewComments.length;
        console.log(`[REVIEW EVENT] Found ${commentCount} comments for review ${review.id}`);
      }
    } catch (error) {
      console.error(`[REVIEW EVENT] Error fetching review comments:`, error);
      // Continue with what we know
    }
    
    // Get Slack user ID for mention
    let slackUserId = null;
    if (reviewer && reviewer.slack_user_id) {
      slackUserId = reviewer.slack_user_id;
    }
    
    // Send message to Slack
    console.log(`[REVIEW EVENT] Sending review message to Slack: ${reviewStatus} with ${commentCount} comments`);
    const message = await slackService.sendReviewMessage(
      org.slack_bot_token,
      pullRequest.slack_channel_id,
      {
        title: pr.title,
        url: pr.html_url,
        prNumber: pr.number,
        reviewer: reviewerUsername,
        reviewerSlackId: slackUserId,
        state: reviewStatus,
        body: review.body, 
        commentCount: commentCount
      }
    );
    
    // Store the comment mapping for two-way sync
    if (message && message.ts) {
      try {
        console.log(`[REVIEW EVENT] Creating comment record for review ${review.id} with thread timestamp ${message.ts}`);
        
        // Create the review summary comment
        const newReviewComment = await db.comments.create({
          id: uuidv4(),
          pr_id: pullRequest.id,
          github_comment_id: commentId,
          slack_thread_ts: message.ts,
          user_id: reviewer.id,
          content: review.body || '',
          source: 'github',
          comment_type: 'review_summary',
          created_at: new Date(review.submitted_at || new Date()).toISOString()
        });
        
        console.log(`[REVIEW EVENT] Created review summary comment with ID: ${newReviewComment.id}`);
      } catch (error) {
        console.error(`[REVIEW EVENT] Error creating review records:`, error);
        throw error;
      }
    }
    
    return {
      status: 'success',
      message: 'Pull request review processed'
    };
  } catch (error) {
    console.error('[REVIEW EVENT] Error handling pull request review event:', error);
    throw error;
  }
};


/**
 * Handle GitHub pull request review comment event
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Result of processing
 */
const handlePullRequestReviewCommentEvent = async (payload) => {
  try {
    const { action, repository, organization, pull_request: pr, comment } = payload;
    
    console.log(`[REVIEW COMMENT] Processing review comment event: ${action} for PR #${pr.number}, comment ID: ${comment.id}`);
    
    // Only process created or edited comments
    if (!['created', 'edited'].includes(action)) {
      console.log(`[REVIEW COMMENT] Ignoring action: ${action}`);
      return {
        status: 'ignored',
        message: `Ignoring action: ${action}`
      };
    }
    
    // Check if this comment already exists in our db with source='slack'
    const existingComment = await db.comments.findByGithubCommentId(null, comment.id.toString());
    
    if (existingComment && existingComment.source === 'slack') {
      console.log(`[REVIEW COMMENT] Comment ${comment.id} originated from Slack, ignoring webhook to prevent duplication`);
      return {
        status: 'ignored',
        message: 'Comment originated from Slack, ignoring to prevent duplication'
      };
    }
    
    // Check if comment includes Slack marker
    if (comment.body && comment.body.includes('<!-- SENT_FROM_SLACK -->')) {
      console.log(`[REVIEW COMMENT] Comment ${comment.id} has Slack marker, ignoring webhook`);
      return {
        status: 'ignored',
        message: 'Comment originated from Slack, ignoring to prevent duplication'
      };
    }
    
    // Get organization from database
    let org = await db.organizations.findByGithubOrgId(organization?.id || repository.owner.id);
    console.log(`[REVIEW COMMENT] Found organization: ${org ? org.id : 'not found'}`);
    
    // If organization doesn't exist, we can't process this webhook
    if (!org) {
      return {
        status: 'error',
        message: 'Organization not registered with PingaPR'
      };
    }
    
    // Find repository in database
    let repo = await db.repositories.findByGithubRepoId(org.id, repository.id);
    console.log(`[REVIEW COMMENT] Found repository: ${repo ? repo.id : 'not found'}`);
    
    // If repo doesn't exist or isn't active, ignore the webhook
    if (!repo || !repo.is_active) {
      return {
        status: 'ignored',
        message: 'Repository not tracked or inactive'
      };
    }
    
    // Find PR in database
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, pr.number);
    console.log(`[REVIEW COMMENT] Found PR: ${pullRequest ? pullRequest.id : 'not found'}`);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Find the commenter
    const commenterUsername = comment.user.login;
    let commenter = await db.users.findByGithubUsername(org.id, commenterUsername);
    console.log(`[REVIEW COMMENT] Found commenter: ${commenter ? commenter.id : 'not found'}`);
    
    if (!commenter) {
      // Create a placeholder user record
      commenter = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: commenterUsername,
        is_admin: false
      });
      console.log(`[REVIEW COMMENT] Created new commenter: ${commenter.id}`);
    }
    
    // Get Slack user ID for mention if available
    let slackUserId = null;
    if (commenter && commenter.slack_user_id) {
      slackUserId = commenter.slack_user_id;
    }
    
    // Determine if this is a reply to another comment
    const isReply = comment.in_reply_to_id !== undefined;
    console.log(`[REVIEW COMMENT] Is this a reply? ${isReply ? 'Yes' : 'No'}`);
    
    if (action === 'created') {
      if (isReply) {
        // This is a reply to another comment - handle it appropriately
        console.log(`[REVIEW COMMENT] This is a reply to comment: ${comment.in_reply_to_id}`);
        
        // Find the parent comment
        const parentComment = await db.comments.findByGithubCommentId(
          pullRequest.id,
          comment.in_reply_to_id.toString()
        );
        
        if (!parentComment) {
          console.log(`[REVIEW COMMENT] Couldn't find parent comment ${comment.in_reply_to_id} in database`);
          
          // Fetch the parent comment from GitHub API since we don't have it
          try {
            const token = await githubAuth.getAccessToken(org.id);
            const originalComment = await githubService.getReviewComment(
              token, 
              repository.full_name, 
              comment.in_reply_to_id
            );
            
            if (originalComment) {
              // First send the original comment if we didn't have it
              const originalMessage = await slackService.sendReviewCommentMessage(
                org.slack_bot_token,
                pullRequest.slack_channel_id,
                null, // Create a new thread
                {
                  author: originalComment.user.login,
                  authorSlackId: slackUserId,
                  body: originalComment.body,
                  url: originalComment.html_url,
                  path: originalComment.path,
                  line: originalComment.line || originalComment.position
                }
              );
              
              // Create the parent comment record
              const newParentComment = await db.comments.create({
                id: uuidv4(),
                pr_id: pullRequest.id,
                github_comment_id: originalComment.id.toString(),
                slack_thread_ts: originalMessage.ts,
                user_id: commenter.id, // Best guess - we don't have the original user's ID
                content: originalComment.body,
                source: 'github',
                comment_type: 'line_comment',
                created_at: new Date(originalComment.created_at).toISOString()
              });
              
              // Now send the reply to that thread
              const replyMessage = await slackService.sendCommentReplyMessage(
                org.slack_bot_token,
                pullRequest.slack_channel_id,
                originalMessage.ts,
                {
                  author: commenterUsername,
                  authorSlackId: slackUserId,
                  body: comment.body,
                  url: comment.html_url
                }
              );
              
              // Create comment record for the reply
              await db.comments.create({
                id: uuidv4(),
                pr_id: pullRequest.id,
                github_comment_id: comment.id.toString(),
                slack_thread_ts: originalMessage.ts,
                parent_comment_id: newParentComment.id,
                user_id: commenter.id,
                content: comment.body,
                source: 'github',
                comment_type: 'reply',
                created_at: new Date(comment.created_at).toISOString()
              });
            }
          } catch (apiError) {
            console.error(`[REVIEW COMMENT] Error fetching original comment: ${apiError}`);
            // Fall back to creating a standalone comment
            const message = await slackService.sendReviewCommentMessage(
              org.slack_bot_token,
              pullRequest.slack_channel_id,
              null,
              {
                author: commenterUsername,
                authorSlackId: slackUserId,
                body: comment.body,
                url: comment.html_url,
                path: comment.path,
                line: comment.line || comment.position
              }
            );
            
            // Create the comment record
            await db.comments.create({
              id: uuidv4(),
              pr_id: pullRequest.id,
              github_comment_id: comment.id.toString(),
              slack_thread_ts: message.ts,
              user_id: commenter.id,
              content: comment.body,
              source: 'github',
              comment_type: 'line_comment',
              created_at: new Date(comment.created_at).toISOString()
            });
          }
        } else {
          // We have the parent comment, send this as a reply
          console.log(`[REVIEW COMMENT] Found parent comment: ${parentComment.id}`);
          
          // Get the thread_ts from the parent comment
          const threadTs = parentComment.slack_thread_ts;
          
          if (!threadTs) {
            console.log(`[REVIEW COMMENT] Parent comment has no thread_ts, creating a new message`);
            
            // Create a new message if there's no thread_ts
            const message = await slackService.sendReviewCommentMessage(
              org.slack_bot_token,
              pullRequest.slack_channel_id,
              null,
              {
                author: commenterUsername,
                authorSlackId: slackUserId,
                body: comment.body,
                url: comment.html_url,
                path: comment.path,
                line: comment.line || comment.position
              }
            );
            
            // Store this comment
            await db.comments.create({
              id: uuidv4(),
              pr_id: pullRequest.id,
              github_comment_id: comment.id.toString(),
              slack_thread_ts: message.ts,
              user_id: commenter.id,
              content: comment.body,
              source: 'github',
              comment_type: 'line_comment',
              created_at: new Date(comment.created_at).toISOString()
            });
          } else {
            // Send as a reply in the parent's thread
            const message = await slackService.sendCommentReplyMessage(
              org.slack_bot_token,
              pullRequest.slack_channel_id,
              threadTs,
              {
                author: commenterUsername,
                authorSlackId: slackUserId,
                body: comment.body,
                url: comment.html_url
              }
            );
            
            // Store this comment with the parent relationship
            await db.comments.create({
              id: uuidv4(),
              pr_id: pullRequest.id,
              github_comment_id: comment.id.toString(),
              slack_thread_ts: threadTs,
              parent_comment_id: parentComment.id,
              user_id: commenter.id,
              content: comment.body,
              source: 'github',
              comment_type: 'reply',
              created_at: new Date(comment.created_at).toISOString()
            });
          }
        }
      } else {
        // This is a new top-level comment
        console.log(`[REVIEW COMMENT] This is a new top-level comment`);
        
        // Find the review summary this comment belongs to
        const reviewId = comment.pull_request_review_id;
        const reviewSummaryId = `review_${reviewId}`;
        
        const reviewSummary = await db.comments.findByGithubCommentId(
          pullRequest.id,
          reviewSummaryId
        );
        
        let threadTs = null;
        let parentId = null;
        
        if (reviewSummary) {
          threadTs = reviewSummary.slack_thread_ts;
          parentId = reviewSummary.id;
          console.log(`[REVIEW COMMENT] Found review summary: ${reviewSummary.id} with thread: ${threadTs}`);
        }
        
        // Post the comment to Slack
        const lineNumber = comment.line || comment.position || 'Unknown line';
        const message = await slackService.sendReviewCommentMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          threadTs, // If null, creates a new thread
          {
            author: commenterUsername,
            authorSlackId: slackUserId,
            body: comment.body,
            url: comment.html_url,
            path: comment.path,
            line: lineNumber
          }
        );
        
        // Store the comment with proper metadata
        const newComment = await db.comments.create({
          id: uuidv4(),
          pr_id: pullRequest.id,
          github_comment_id: comment.id.toString(),
          slack_thread_ts: threadTs || message.ts, // Use review thread or new message's ts
          slack_message_ts: message.ts, // Store the specific message timestamp
          parent_comment_id: parentId,
          user_id: commenter.id,
          content: comment.body,
          source: 'github',
          comment_type: 'line_comment',
          created_at: new Date(comment.created_at).toISOString()
        });
        
        console.log(`[REVIEW COMMENT] Created line comment record with ID: ${newComment.id}`);
      }
    } else if (action === 'edited') {
      // Find the comment in our database
      const existingComment = await db.comments.findByGithubCommentId(
        pullRequest.id,
        comment.id.toString()
      );
      
      if (existingComment) {
        console.log(`[REVIEW COMMENT] Updating existing comment: ${existingComment.id}`);
        // Update the comment content
        await db.comments.update(existingComment.id, {
          content: comment.body,
          updated_at: new Date().toISOString()
        });
        
        // Send edit notification to Slack
        await slackService.sendCommentEditedMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          existingComment.slack_thread_ts,
          {
            author: commenterUsername,
            body: comment.body,
            url: comment.html_url
          }
        );
      }
    }
    
    return {
      status: 'success',
      message: `Comment ${action} processed`
    };
  } catch (error) {
    console.error('[REVIEW COMMENT] Error handling pull request review comment event:', error);
    throw error;
  }
};

// This simple caching approach:

// Stores tokens in memory with their expiry times
// Checks the cache first before making database queries
// Updates the cache when tokens are refreshed
// Uses a shorter expiry for app tokens (which might be rotated externally)



// Early filtering of duplicate 'edited' events
// Proper comment counting for reviews with 'changes_requested' or 'approved' status
// Logic to show summary messages instead of full review content in Slack
// Maintenance of the two-way sync by storing comment mappings
// Error handling for race conditions and duplicate events

/**
 * Handle GitHub pull request comment event (issue_comment)
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Result of processing
 */
const handlePullRequestCommentEvent = async (payload) => {
  try {
    const { action, repository, organization, issue, comment } = payload;
    
    console.log(`[PR COMMENT] Processing PR comment event: ${action} for PR #${issue.number}, comment ID: ${comment.id}`);
    
    // Only process created or edited comments
    if (!['created', 'edited'].includes(action)) {
      console.log(`[PR COMMENT] Ignoring action: ${action}`);
      return {
        status: 'ignored',
        message: `Comment action '${action}' not handled`
      };
    }

    // Check if this comment already exists in our db with source='slack'
    const existingComment = await db.comments.findByGithubCommentId(
      null, // We don't know the PR ID yet, will check all comments
      comment.id.toString()
    );
    
    // If comment exists and was from Slack, ignore it to prevent duplication
    if (existingComment && existingComment.source === 'slack') {
      console.log(`[PR COMMENT] Comment ${comment.id} originated from Slack, ignoring webhook to prevent duplication`);
      return {
        status: 'ignored',
        message: 'Comment originated from Slack, ignoring to prevent duplication'
      };
    }

    // Check if comment includes Slack marker
    if (comment.body && comment.body.includes('<!-- SENT_FROM_SLACK -->')) {
      console.log(`[PR COMMENT] Comment ${comment.id} has Slack marker, ignoring webhook`);
      return {
        status: 'ignored',
        message: 'Comment originated from Slack, ignoring to prevent duplication'
      };
    }
    
    // Get organization from database
    let org = await db.organizations.findByGithubOrgId(organization?.id || repository.owner.id);
    console.log(`[PR COMMENT] Found organization: ${org ? org.id : 'not found'}`);
    
    // If organization doesn't exist, we can't process this webhook
    if (!org) {
      return {
        status: 'error',
        message: 'Organization not registered with PingaPR'
      };
    }
    
    // Find repository in database
    let repo = await db.repositories.findByGithubRepoId(org.id, repository.id);
    console.log(`[PR COMMENT] Found repository: ${repo ? repo.id : 'not found'}`);
    
    // If repo doesn't exist or isn't active, ignore the webhook
    if (!repo || !repo.is_active) {
      return {
        status: 'ignored',
        message: 'Repository not tracked or inactive'
      };
    }
    
    // Find PR in database by issue number (for PR comments, issue number = PR number)
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, issue.number);
    console.log(`[PR COMMENT] Found PR: ${pullRequest ? pullRequest.id : 'not found'}`);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Find the commenter
    const commenterUsername = comment.user.login;
    let commenter = await db.users.findByGithubUsername(org.id, commenterUsername);
    console.log(`[PR COMMENT] Found commenter: ${commenter ? commenter.id : 'not found'}`);
    
    if (!commenter) {
      // Create a placeholder user record
      commenter = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: commenterUsername,
        is_admin: false
      });
      console.log(`[PR COMMENT] Created new commenter: ${commenter.id}`);
    }
    
    // Get Slack user ID for mention if available
    let slackUserId = null;
    if (commenter && commenter.slack_user_id) {
      slackUserId = commenter.slack_user_id;
    }
    
    // Determine if this is a reply to another PR comment
    const isReply = comment.in_reply_to_id !== undefined || 
                    (comment.body && comment.body.includes('Re: [comment]'));
    console.log(`[PR COMMENT] Is this a reply? ${isReply ? 'Yes' : 'No'}`);
    
    let message;
    
    if (action === 'created') {
      console.log(`[PR COMMENT] Sending new PR comment to Slack`);
      
      // This is a new comment
      message = await slackService.sendPrCommentMessage(
        org.slack_bot_token,
        pullRequest.slack_channel_id,
        {
          author: commenterUsername,
          authorSlackId: slackUserId,
          body: comment.body,
          url: comment.html_url
        }
      );
      
      // Store the comment mapping for two-way sync
      if (message && message.ts) {
        const newComment = await db.comments.create({
          id: uuidv4(),
          pr_id: pullRequest.id,
          github_comment_id: comment.id.toString(),
          slack_thread_ts: message.ts,
          slack_message_ts: message.ts, // For PR comments, these are the same
          user_id: commenter.id,
          content: comment.body,
          source: 'github',
          comment_type: 'pr_comment',
          created_at: new Date(comment.created_at).toISOString()
        });
        
        console.log(`[PR COMMENT] Created PR comment record with ID: ${newComment.id}`);
      } else {
        console.log(`[PR COMMENT] Failed to get Slack message TS`);
      }
    } else if (action === 'edited') {
      console.log(`[PR COMMENT] Processing edited PR comment`);
      
      // Find the comment in our database
      const existingComment = await db.comments.findByGithubCommentId(
        pullRequest.id,
        comment.id.toString()
      );
      
      if (existingComment) {
        console.log(`[PR COMMENT] Updating existing comment: ${existingComment.id}`);
        
        // Update the comment content
        await db.comments.update(existingComment.id, {
          content: comment.body,
          updated_at: new Date().toISOString()
        });
        
        // Send edit notification to Slack
        await slackService.sendCommentEditedMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          existingComment.slack_thread_ts,
          {
            author: commenterUsername,
            body: comment.body,
            url: comment.html_url
          }
        );
        
        console.log(`[PR COMMENT] Sent edit notification to Slack`);
      } else {
        console.log(`[PR COMMENT] Could not find comment in database for edit`);
      }
    }
    
    console.log(`[PR COMMENT] Successfully processed PR comment ${comment.id}`);
    
    return {
      status: 'success',
      message: `PR comment ${action} processed`
    };
  } catch (error) {
    console.error('[PR COMMENT] Error handling pull request comment event:', error);
    throw error;
  }
};

/**
 * Process a review request
 * @param {Object} org - Organization data
 * @param {Object} pullRequest - Pull request data
 * @param {string} reviewerUsername - GitHub username of reviewer
 */
const processReviewRequest = async (org, pullRequest, reviewerUsername) => {
  try {
    console.log('Processing review request for:', reviewerUsername);
    console.log('Slack channel ID:', pullRequest.slack_channel_id);

    // Find or create reviewer user
    let reviewer = await db.users.findByGithubUsername(org.id, reviewerUsername);
    
    console.log('Reviewer data:', reviewer);

    if (!reviewer) {
      // Create a placeholder user record
      reviewer = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: reviewerUsername,
        is_admin: false
      });
    }
    
    // Create or update review request
    const now = new Date().toISOString();
    await db.reviewRequests.upsert(pullRequest.id, reviewer.id, {
      status: 'pending',
      requested_at: now
    });
    
    // If there's a Slack channel, add the reviewer and send notification
    if (pullRequest.slack_channel_id) {
      // Add reviewer to channel if they have a Slack ID
      if (reviewer.slack_user_id) {
        await slackChannels.inviteUserToChannel(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          reviewer.slack_user_id
        );
      }
      
      // Send notification
      // await slackService.sendReviewRequestedMessage(
      //   org.slack_bot_token,
      //   pullRequest.slack_channel_id,
      //   {
      //     reviewer: reviewerUsername,
      //     slackUserId: reviewer.slack_user_id
      //   }
      // );
    }
  } catch (error) {
    console.error('Error processing review request:', error);
    throw error;
  }
};

module.exports = {
  handlePingEvent,
  handlePullRequestEvent,
  handlePullRequestReviewEvent,
  handlePullRequestReviewCommentEvent,
  handlePullRequestCommentEvent
};
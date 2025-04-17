/**
 * GitHub webhooks service
 * Handles processing of GitHub webhook events
 */
const { v4: uuidv4 } = require('uuid');
const db = require('../../services/supabase/functions');
const slackService = require('../../services/slack/messages');
const slackChannels = require('../../services/slack/channels');
const { formatPrDescription } = require('../../utils/formatting');

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
    
    // Process requested reviewers
    if (pr.requested_reviewers && pr.requested_reviewers.length > 0) {
      for (const reviewer of pr.requested_reviewers) {
        await processReviewRequest(org, pullRequest, reviewer.login);
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
        author: authorUsername,
        repoName: repo.github_repo_name,
        description: formattedDescription,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        labels: pr.labels.map(l => l.name)
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
const { v4: uuidv4 /**
 * Handle GitHub pull request review event
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Result of processing
 */
const handlePullRequestReviewEvent = async (payload) => {
  try {
    const { action, repository, organization, pull_request: pr, review } = payload;
    
    // Get organization from database
    let org = await db.organizations.findByGithubOrgId(organization?.id || repository.owner.id);
    
    // If organization doesn't exist, we can't process this webhook
    if (!org) {
      return {
        status: 'error',
        message: 'Organization not registered with PingaPR'
      };
    }
    
    // Find repository in database
    let repo = await db.repositories.findByGithubRepoId(org.id, repository.id);
    
    // If repo doesn't exist or isn't active, ignore the webhook
    if (!repo || !repo.is_active) {
      return {
        status: 'ignored',
        message: 'Repository not tracked or inactive'
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
    const reviewerUsername = review.user.login;
    let reviewer = await db.users.findByGithubUsername(org.id, reviewerUsername);
    
    if (!reviewer) {
      // Create a placeholder user record
      reviewer = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: reviewerUsername,
        is_admin: false
      });
    }
    
    // Find or create review request
    const reviewRequest = await db.reviewRequests.findByPrAndReviewer(
      pullRequest.id,
      reviewer.id
    );
    
    // Update review request status based on review state
    const reviewStatus = review.state.toLowerCase();
    
    if (reviewRequest) {
      await db.reviewRequests.update(reviewRequest.id, {
        status: reviewStatus,
        completed_at: ['approved', 'changes_requested'].includes(reviewStatus)
          ? new Date().toISOString()
          : null
      });
    } else if (['approved', 'changes_requested', 'commented'].includes(reviewStatus)) {
      // Create a new review request if one doesn't exist
      await db.reviewRequests.create({
        id: uuidv4(),
        pr_id: pullRequest.id,
        reviewer_id: reviewer.id,
        status: reviewStatus,
        requested_at: new Date(review.submitted_at || new Date()).toISOString(),
        completed_at: ['approved', 'changes_requested'].includes(reviewStatus)
          ? new Date().toISOString()
          : null
      });
    }
    
    // If the review has a body, create a comment record for two-way sync
    if (review.body) {
      // Store as a special comment type for reviews
      const commentId = `review_${review.id}`;
      
      // Send to Slack and get thread timestamp
      const message = await slackService.sendReviewMessage(
        org.slack_bot_token,
        pullRequest.slack_channel_id,
        {
          title: pr.title,
          url: pr.html_url,
          reviewer: reviewerUsername,
          state: reviewStatus,
          body: review.body
        }
      );
      
      // Store the comment mapping for two-way sync
      if (message && message.ts) {
        await db.comments.create({
          id: uuidv4(),
          pr_id: pullRequest.id,
          github_comment_id: commentId,
          slack_thread_ts: message.ts,
          user_id: reviewer.id,
          content: review.body,
          created_at: new Date(review.submitted_at || new Date()).toISOString()
        });
      }
    } else {
      // Just send the review status without creating a comment record
      await slackService.sendReviewStateMessage(
        org.slack_bot_token,
        pullRequest.slack_channel_id,
        {
          title: pr.title,
          url: pr.html_url,
          reviewer: reviewerUsername,
          state: reviewStatus
        }
      );
    }
    
    return {
      status: 'success',
      message: 'Pull request review processed'
    };
  } catch (error) {
    console.error('Error handling pull request review event:', error);
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
    
    // Only process created or edited comments
    if (!['created', 'edited'].includes(action)) {
      return {
        status: 'ignored',
        message: `Comment action '${action}' not handled`
      };
    }
    
    // Get organization from database
    let org = await db.organizations.findByGithubOrgId(organization?.id || repository.owner.id);
    
    // If organization doesn't exist, we can't process this webhook
    if (!org) {
      return {
        status: 'error',
        message: 'Organization not registered with PingaPR'
      };
    }
    
    // Find repository in database
    let repo = await db.repositories.findByGithubRepoId(org.id, repository.id);
    
    // If repo doesn't exist or isn't active, ignore the webhook
    if (!repo || !repo.is_active) {
      return {
        status: 'ignored',
        message: 'Repository not tracked or inactive'
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
    
    // Find the commenter
    const commenterUsername = comment.user.login;
    let commenter = await db.users.findByGithubUsername(org.id, commenterUsername);
    
    if (!commenter) {
      // Create a placeholder user record
      commenter = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: commenterUsername,
        is_admin: false
      });
    }
    
    // Check if this is a new comment or a reply to another comment
    const inReplyTo = comment.in_reply_to_id ? await db.comments.findByGithubCommentId(
      pullRequest.id,
      comment.in_reply_to_id.toString()
    ) : null;
    
    let message;
    
    if (action === 'created') {
      if (inReplyTo) {
        // This is a reply to an existing comment
        message = await slackService.sendCommentReplyMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          inReplyTo.slack_thread_ts,
          {
            author: commenterUsername,
            body: comment.body,
            url: comment.html_url,
            diffHunk: comment.diff_hunk,
            path: comment.path
          }
        );
      } else {
        // This is a new comment
        message = await slackService.sendReviewCommentMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          {
            author: commenterUsername,
            body: comment.body,
            url: comment.html_url,
            diffHunk: comment.diff_hunk,
            path: comment.path
          }
        );
      }
      
      // Store the comment mapping for two-way sync
      if (message && message.ts) {
        await db.comments.create({
          id: uuidv4(),
          pr_id: pullRequest.id,
          github_comment_id: comment.id.toString(),
          slack_thread_ts: inReplyTo ? inReplyTo.slack_thread_ts : message.ts,
          user_id: commenter.id,
          content: comment.body,
          created_at: new Date(comment.created_at).toISOString()
        });
      }
    } else if (action === 'edited') {
      // Find the comment in our database
      const existingComment = await db.comments.findByGithubCommentId(
        pullRequest.id,
        comment.id.toString()
      );
      
      if (existingComment) {
        // Update the comment content
        await db.comments.update(existingComment.id, {
          content: comment.body
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
    console.error('Error handling pull request review comment event:', error);
    throw error;
  }
};

/**
 * Handle GitHub pull request comment event (issue_comment)
 * @param {Object} payload - GitHub webhook payload
 * @returns {Object} Result of processing
 */
const handlePullRequestCommentEvent = async (payload) => {
  try {
    const { action, repository, organization, issue, comment } = payload;
    
    // Only process created or edited comments
    if (!['created', 'edited'].includes(action)) {
      return {
        status: 'ignored',
        message: `Comment action '${action}' not handled`
      };
    }
    
    // Get organization from database
    let org = await db.organizations.findByGithubOrgId(organization?.id || repository.owner.id);
    
    // If organization doesn't exist, we can't process this webhook
    if (!org) {
      return {
        status: 'error',
        message: 'Organization not registered with PingaPR'
      };
    }
    
    // Find repository in database
    let repo = await db.repositories.findByGithubRepoId(org.id, repository.id);
    
    // If repo doesn't exist or isn't active, ignore the webhook
    if (!repo || !repo.is_active) {
      return {
        status: 'ignored',
        message: 'Repository not tracked or inactive'
      };
    }
    
    // Find PR in database by issue number (for PR comments, issue number = PR number)
    const pullRequest = await db.pullRequests.findByPrNumber(repo.id, issue.number);
    
    if (!pullRequest) {
      return {
        status: 'error',
        message: 'Pull request not found in database'
      };
    }
    
    // Find the commenter
    const commenterUsername = comment.user.login;
    let commenter = await db.users.findByGithubUsername(org.id, commenterUsername);
    
    if (!commenter) {
      // Create a placeholder user record
      commenter = await db.users.create({
        id: uuidv4(),
        org_id: org.id,
        github_username: commenterUsername,
        is_admin: false
      });
    }
    
    let message;
    
    if (action === 'created') {
      // This is a new comment
      message = await slackService.sendPrCommentMessage(
        org.slack_bot_token,
        pullRequest.slack_channel_id,
        {
          author: commenterUsername,
          body: comment.body,
          url: comment.html_url
        }
      );
      
      // Store the comment mapping for two-way sync
      if (message && message.ts) {
        await db.comments.create({
          id: uuidv4(),
          pr_id: pullRequest.id,
          github_comment_id: comment.id.toString(),
          slack_thread_ts: message.ts,
          user_id: commenter.id,
          content: comment.body,
          created_at: new Date(comment.created_at).toISOString()
        });
      }
    } else if (action === 'edited') {
      // Find the comment in our database
      const existingComment = await db.comments.findByGithubCommentId(
        pullRequest.id,
        comment.id.toString()
      );
      
      if (existingComment) {
        // Update the comment content
        await db.comments.update(existingComment.id, {
          content: comment.body
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
      message: `PR comment ${action} processed`
    };
  } catch (error) {
    console.error('Error handling pull request comment event:', error);
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
    // Find or create reviewer user
    let reviewer = await db.users.findByGithubUsername(org.id, reviewerUsername);
    
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
      await slackService.sendReviewRequestedMessage(
        org.slack_bot_token,
        pullRequest.slack_channel_id,
        {
          reviewer: reviewerUsername,
          slackUserId: reviewer.slack_user_id
        }
      );
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
// src/api/controllers/slack/events.js
const db = require('../../../services/supabase/functions');
const githubService = require('../../../services/github/api');
const slackService = require('../../../services/slack/auth');
const { v4: uuidv4 } = require('uuid');

// Handle Slack events
const handleEvents = async (req, res) => {
  console.log('recieved call:')
  const { type, event, challenge } = req.body;
  
  console.log('type and event and challenge: ', type, event, challenge)
  // Handle URL verification
  if (type === 'url_verification') {
    return res.status(200).json({ challenge });
  }
  
  // For other events, respond immediately to avoid Slack timeout
  res.status(200).send();
  
  try {
    // Only process message events in threads
    if (event && event.type === 'message' && event.thread_ts && !event.bot_id) {
      console.log('i am here inside handle events')
      await processThreadReply(event);
    }
  } catch (error) {
    console.error('Error processing Slack event:', error);
  }
};

// Process replies in threads to sync back to GitHub
const processThreadReply = async (event) => {
  try {
    console.log(`Processing thread reply in Slack: ${event.thread_ts}`);
    
    // Skip messages from the bot itself
    if (event.bot_id) {
      console.log('Skipping message from bot');
      return;
    }
    
    // Find comment mapping for this thread
    const comment = await db.comments.findByThreadTs(event.thread_ts);
    
    if (!comment) {
      console.log('No GitHub comment found for thread:', event.thread_ts);
      return;
    }
    
    console.log(`Found comment: ID=${comment.id}, type=${comment.comment_type || 'unknown'}, github_comment_id=${comment.github_comment_id}`);
    
    // Make sure we have all the necessary data
    if (!comment.pull_request) {
      console.log('Pull request data missing, fetching directly');
      
      // Find the pull request directly
      const pullRequest = await db.pullRequests.findById(comment.pr_id);
      if (!pullRequest) {
        console.log('Pull request not found for comment:', comment.pr_id);
        return;
      }
      
      // Find repository
      const repo = await db.repositories.findById(pullRequest.repo_id);
      if (!repo) {
        console.log('Repository not found for pull request:', pullRequest.repo_id);
        return;
      }
      
      // Find organization
      const org = await db.organizations.findById(repo.org_id);
      if (!org) {
        console.log('Organization not found for repository:', repo.org_id);
        return;
      }
      
      // Find user who sent the message
      const user = await db.users.findBySlackUserId(org.id, event.user);
      
      if (!user) {
        console.log('User not found:', event.user);
        
        // Send a helpful message to the user
        await slackService.sendErrorMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          event.thread_ts,
          "You need to connect your GitHub account before replying to comments. Please click on 'Connect GitHub' in the sidebar."
        );
        return;
      }
      
      // Check if user has a GitHub token
      if (!user.github_access_token) {
        console.log('User has no GitHub token:', event.user);
        
        // Send a helpful message to the user
        await slackService.sendErrorMessage(
          org.slack_bot_token,
          pullRequest.slack_channel_id,
          event.thread_ts,
          "Your GitHub account isn't connected. Please click on 'Connect GitHub' in the sidebar to enable two-way sync."
        );
        return;
      }
      
      // Token refresh logic
      let validToken = user.github_access_token;
      
      // Only try refresh if we have a refresh token
      if (user.github_refresh_token) {
        // Check if token is expired or about to expire (within 5 minutes)
        const tokenExpiresAt = new Date(user.github_token_expires_at || 0);
        const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
        
        if (tokenExpiresAt < fiveMinutesFromNow) {
          console.log(`Token for user ${user.id} is expired or about to expire, refreshing...`);
          try {
            // Refresh token
            const refreshedTokens = await githubService.refreshToken(user.github_refresh_token);
            
            // Update user tokens in database
            await db.users.update(user.id, {
              github_access_token: refreshedTokens.access_token,
              github_token_expires_at: refreshedTokens.expires_at,
              github_refresh_token: refreshedTokens.refresh_token || user.github_refresh_token,
              github_refresh_token_expires_at: refreshedTokens.refresh_token_expires_at || user.github_refresh_token_expires_at
            });
            
            // Update token variable
            validToken = refreshedTokens.access_token;
            console.log('Token refreshed successfully');
          } catch (refreshError) {
            console.error('Error refreshing GitHub token:', refreshError);
            
            // Mark token as expired in database to prevent future refresh attempts
            await db.users.update(user.id, {
              github_token_expires_at: new Date(0).toISOString() // Set to epoch time
            });
            
            // Send a message to the user about re-authentication
            await slackService.sendErrorMessage(
              org.slack_bot_token,
              pullRequest.slack_channel_id,
              event.thread_ts,
              "Your GitHub authentication has expired. Please click on 'Connect GitHub' in the sidebar to reconnect your account."
            );
            return;
          }
        }
      } else if (!user.github_refresh_token) {
        // User doesn't have a refresh token
        console.log('User has no GitHub refresh token:', event.user);
        
        // Check if token is expired
        const tokenExpiresAt = new Date(user.github_token_expires_at || 0);
        if (tokenExpiresAt < new Date()) {
          await slackService.sendErrorMessage(
            org.slack_bot_token,
            pullRequest.slack_channel_id,
            event.thread_ts,
            "Your GitHub authentication has expired. Please click on 'Connect GitHub' in the sidebar to reconnect your account."
          );
          return;
        }
      }
      
      // Mark the message with a hidden marker so we can identify it later
      const markedText = `${event.text}\n<!-- SENT_FROM_SLACK -->`;
      
      // Post reply to GitHub - use the actual comment ID
      const targetCommentId = comment.github_comment_id;
      
      console.log(`Sending reply to GitHub comment: ${targetCommentId}`);
      
      try {
        const gitHubComment = await githubService.createCommentReply(
          validToken,
          repo.github_repo_name,
          pullRequest.github_pr_number,
          targetCommentId,
          markedText
        );
        
        // Store this comment with the 'slack' source flag
        if (gitHubComment && gitHubComment.id) {
          const slackComment = await db.comments.create({
            id: uuidv4(),
            pr_id: comment.pr_id,
            github_comment_id: gitHubComment.id.toString(),
            slack_thread_ts: event.thread_ts, // Same thread as parent
            user_id: user.id,
            content: event.text,
            source: 'slack',
            comment_type: 'reply',
            parent_comment_id: comment.id,
            created_at: new Date().toISOString()
          });
          
          console.log(`Created Slack-sourced comment record: ${slackComment.id}, parent: ${comment.id}`);
        } else {
          console.log('Failed to get GitHub comment ID from API response');
        }
      } catch (apiError) {
        console.error('Error posting to GitHub:', apiError);
        
        // If this is an auth error, notify the user
        if (apiError.status === 401) {
          await slackService.sendErrorMessage(
            org.slack_bot_token,
            pullRequest.slack_channel_id,
            event.thread_ts,
            "Failed to post your comment to GitHub due to authentication issues. Please click on 'Connect GitHub' in the sidebar to reconnect your account."
          );
        } else {
          await slackService.sendErrorMessage(
            org.slack_bot_token,
            pullRequest.slack_channel_id,
            event.thread_ts,
            'Failed to post your comment to GitHub. Please try again later.'
          );
        }
      }
      
      return;
    }
    
    // If we have the nested data, use it directly
    const repo = comment.pull_request.repository;
    const org_id = repo.org_id;
    
    // Find organization first to handle potential errors
    const org = await db.organizations.findById(org_id);
    if (!org) {
      console.log('Organization not found for repository:', org_id);
      return;
    }
    
    // Find user who sent the message
    const user = await db.users.findBySlackUserId(org_id, event.user);
    
    if (!user) {
      console.log('User not found:', event.user);
      
      await slackService.sendErrorMessage(
        org.slack_bot_token,
        comment.pull_request.slack_channel_id,
        event.thread_ts,
        "You need to connect your GitHub account before replying to comments. Please click on 'Connect GitHub' in the sidebar."
      );
      return;
    }
    
    // Check if user has a GitHub token
    if (!user.github_access_token) {
      console.log('User has no GitHub token:', event.user);
      
      await slackService.sendErrorMessage(
        org.slack_bot_token,
        comment.pull_request.slack_channel_id,
        event.thread_ts,
        "Your GitHub account isn't connected. Please click on 'Connect GitHub' in the sidebar to enable two-way sync."
      );
      return;
    }
    
    // Token refresh logic
    let validToken = user.github_access_token;
    
    // Only try refresh if we have a refresh token
    if (user.github_refresh_token) {
      // Check if token is expired or about to expire (within 5 minutes)
      const tokenExpiresAt = new Date(user.github_token_expires_at || 0);
      const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
      
      if (tokenExpiresAt < fiveMinutesFromNow) {
        console.log(`Token for user ${user.id} is expired or about to expire, refreshing...`);
        try {
          // Refresh token
          const refreshedTokens = await githubService.refreshToken(user.github_refresh_token);
          
          // Update user tokens in database
          await db.users.update(user.id, {
            github_access_token: refreshedTokens.access_token,
            github_token_expires_at: refreshedTokens.expires_at,
            github_refresh_token: refreshedTokens.refresh_token || user.github_refresh_token,
            github_refresh_token_expires_at: refreshedTokens.refresh_token_expires_at || user.github_refresh_token_expires_at
          });
          
          // Update token variable
          validToken = refreshedTokens.access_token;
          console.log('Token refreshed successfully');
        } catch (refreshError) {
          console.error('Error refreshing GitHub token:', refreshError);
          
          // Mark token as expired in database to prevent future refresh attempts
          await db.users.update(user.id, {
            github_token_expires_at: new Date(0).toISOString() // Set to epoch time
          });
          
          // Send a message to the user about re-authentication
          await slackService.sendErrorMessage(
            org.slack_bot_token,
            comment.pull_request.slack_channel_id,
            event.thread_ts,
            "Your GitHub authentication has expired. Please click on 'Connect GitHub' in the sidebar to reconnect your account."
          );
          return;
        }
      }
    } else if (!user.github_refresh_token) {
      // User doesn't have a refresh token
      console.log('User has no GitHub refresh token:', event.user);
      
      // Check if token is expired
      const tokenExpiresAt = new Date(user.github_token_expires_at || 0);
      if (tokenExpiresAt < new Date()) {
        await slackService.sendErrorMessage(
          org.slack_bot_token,
          comment.pull_request.slack_channel_id,
          event.thread_ts,
          "Your GitHub authentication has expired. Please click on 'Connect GitHub' in the sidebar to reconnect your account."
        );
        return;
      }
    }
    
    // Mark the message with a hidden marker so we can identify it later
    const markedText = `${event.text}\n<!-- SENT_FROM_SLACK -->`;
    
    // Post reply to GitHub
    const targetCommentId = comment.github_comment_id;
    
    console.log(`Sending reply to GitHub comment: ${targetCommentId}`);
    
    try {
      const gitHubComment = await githubService.createCommentReply(
        validToken,
        repo.github_repo_name,
        comment.pull_request.github_pr_number,
        targetCommentId,
        markedText
      );
      
      // Store this comment with the 'slack' source flag
      if (gitHubComment && gitHubComment.id) {
        const slackComment = await db.comments.create({
          id: uuidv4(),
          pr_id: comment.pr_id,
          github_comment_id: gitHubComment.id.toString(),
          slack_thread_ts: event.thread_ts, // Same thread as parent
          user_id: user.id,
          content: event.text,
          source: 'slack',
          comment_type: 'reply',
          parent_comment_id: comment.id,
          created_at: new Date().toISOString()
        });
        
        console.log(`Created Slack-sourced comment record: ${slackComment.id}, parent: ${comment.id}`);
      } else {
        console.log('Failed to get GitHub comment ID from API response');
      }
    } catch (apiError) {
      console.error('Error posting to GitHub:', apiError);
      
      // If this is an auth error, notify the user
      if (apiError.status === 401) {
        await slackService.sendErrorMessage(
          org.slack_bot_token,
          comment.pull_request.slack_channel_id,
          event.thread_ts,
          "Failed to post your comment to GitHub due to authentication issues. Please click on 'Connect GitHub' in the sidebar to reconnect your account."
        );
      } else {
        await slackService.sendErrorMessage(
          org.slack_bot_token,
          comment.pull_request.slack_channel_id,
          event.thread_ts,
          'Failed to post your comment to GitHub. Please try again later.'
        );
      }
    }
  } catch (error) {
    console.error('Error in processThreadReply:', error);
  }
};

module.exports = {
  handleEvents
};
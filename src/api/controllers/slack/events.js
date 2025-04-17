// src/api/controllers/slack/events.js
const db = require('../../../services/supabase/functions');
const githubService = require('../../../services/github/api');

// Handle Slack events
const handleEvents = async (req, res) => {
  // Respond immediately to avoid Slack timeout
  res.status(200).send();
  
  const { type, event } = req.body;
  
  // Handle URL verification
  if (type === 'url_verification') {
    return res.status(200).json({ challenge: req.body.challenge });
  }
  
  try {
    // Only process message events in threads
    if (event.type === 'message' && event.thread_ts && !event.bot_id) {
      await processThreadReply(event);
    }
  } catch (error) {
    console.error('Error processing Slack event:', error);
  }
};

// Process replies in threads to sync back to GitHub
const processThreadReply = async (event) => {
  // Find comment mapping for this thread
  const comment = await db.comments.findByThreadTs(event.thread_ts);
  
  if (!comment) {
    console.log('No GitHub comment found for thread:', event.thread_ts);
    return;
  }
  
  // Find user who sent the message
  const user = await db.users.findBySlackUserId(
    comment.pull_request.repository.org_id,
    event.user
  );
  
  if (!user || !user.github_access_token) {
    console.log('User not found or not authenticated with GitHub');
    return;
  }
  
  // Post reply to GitHub using user's GitHub token
  await githubService.createCommentReply(
    user.github_access_token,
    comment.pull_request.repository.github_repo_name,
    comment.pull_request.github_pr_number,
    comment.github_comment_id,
    event.text
  );
};

module.exports = {
  handleEvents
};
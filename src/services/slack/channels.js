/**
 * Slack channels service
 * Handles creation and management of Slack channels
 */
const { WebClient } = require('@slack/web-api');
const db = require('../supabase/functions');

/**
 * Create a new Slack channel for a PR
 * @param {Object} org - Organization data
 * @param {Object} pullRequest - Pull request data
 * @param {Object} repo - Repository data
 * @returns {Promise<Object>} Created channel data
 */
const createPrChannel = async (org, pullRequest, repo) => {
  try {
    const client = new WebClient(org.slack_bot_token);
    
    // Create channel name from PR info
    // Format: pr-123-title-with-dashes
    const prNumber = pullRequest.github_pr_number;
    const prTitle = pullRequest.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .substring(0, 30); // Limit length
    
    const channelName = `pr-${prNumber}-${prTitle}`;
    
    // Create the channel
    const response = await client.conversations.create({
      name: channelName,
      is_private: false
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create Slack channel: ${response.error}`);
    }
    
    const channel = response.channel;
    
    // Set channel topic with PR info
    await client.conversations.setTopic({
      channel: channel.id,
      topic: `PR #${prNumber}: ${pullRequest.title} | ${repo.github_repo_name}`
    });
    
    // Add PR author to channel if they have a Slack ID
    const author = await db.users.findById(pullRequest.author_id);
    if (author && author.slack_user_id) {
      await inviteUserToChannel(org.slack_bot_token, channel.id, author.slack_user_id);
    }
    
    return channel;
  } catch (error) {
    console.error('Error creating Slack channel for PR:', error);
    throw error;
  }
};

/**
 * Invite a user to a channel
 * @param {string} token - Slack bot token
 * @param {string} channelId - Channel ID
 * @param {string} userId - Slack user ID
 * @returns {Promise<Object>} Slack API response
 */
const inviteUserToChannel = async (token, channelId, userId) => {
  try {
    const client = new WebClient(token);
    
    const response = await client.conversations.invite({
      channel: channelId,
      users: userId
    });
    
    return response;
  } catch (error) {
    // Don't fail if user is already in channel
    if (error.data && error.data.error === 'already_in_channel') {
      return { ok: true, already_in_channel: true };
    }
    
    console.error('Error inviting user to channel:', error);
    throw error;
  }
};

/**
 * Archive a channel
 * @param {string} token - Slack bot token
 * @param {string} channelId - Channel ID
 * @returns {Promise<Object>} Slack API response
 */
const archiveChannel = async (token, channelId) => {
  try {
    const client = new WebClient(token);
    
    const response = await client.conversations.archive({
      channel: channelId
    });
    
    return response;
  } catch (error) {
    // Don't fail if channel is already archived
    if (error.data && error.data.error === 'already_archived') {
      return { ok: true, already_archived: true };
    }
    
    console.error('Error archiving channel:', error);
    throw error;
  }
};

/**
 * Check and archive channels for closed PRs
 * This is called by the scheduled job
 */
const checkAndArchiveChannels = async () => {
  try {
    // Get list of channels to archive from Supabase function
    const channelsToArchive = await db.pullRequests.checkChannelsToArchive();
    
    for (const channel of channelsToArchive) {
      try {
        // Archive the channel
        await archiveChannel(channel.slack_bot_token, channel.slack_channel_id);
        console.log(`Archived channel for PR ${channel.pr_id}`);
      } catch (error) {
        console.error(`Error archiving channel for PR ${channel.pr_id}:`, error);
        // Continue with other channels even if one fails
      }
    }
    
    return {
      success: true,
      channelsArchived: channelsToArchive.length
    };
  } catch (error) {
    console.error('Error checking and archiving channels:', error);
    throw error;
  }
};

module.exports = {
  createPrChannel,
  inviteUserToChannel,
  archiveChannel,
  checkAndArchiveChannels
};
/**
 * PR reminder service
 * Handles sending reminders for PRs awaiting review
 */
const db = require('../supabase/functions');
const slackService = require('../slack/messages');
const { WebClient } = require('@slack/web-api');

/**
 * Process and send reminders for stale PRs
 * This is called by the scheduled job
 * @returns {Promise<Object>} Summary of processed reminders
 */
const processReminders = async () => {
  try {
    // Get list of stale PRs from Supabase function
    const stalePRs = await db.pullRequests.checkStalePRs();
    
    console.log(`Found ${stalePRs.length} stale PRs needing reminders`);
    
    let sent = 0;
    let failed = 0;
    
    for (const pr of stalePRs) {
      try {
        // Skip PRs without reviewers
        if (!pr.reviewers || pr.reviewers.length === 0) {
          continue;
        }
        
        // Calculate hours since PR was opened
        const pullRequest = await db.pullRequests.findById(pr.pr_id);
        const createdAt = new Date(pullRequest.created_at);
        const now = new Date();
        const hoursOpen = Math.round((now - createdAt) / (1000 * 60 * 60));
        
        // Format reviewers for the notification
        const reviewers = pr.reviewers.map(reviewer => ({
          githubUsername: reviewer.github_username,
          slackUserId: reviewer.slack_user_id
        }));
        
        // Send the reminder
        await slackService.sendPrReminderMessage(
          pr.slack_bot_token,
          pr.slack_channel_id,
          {
            prNumber: pr.pr_github_number,
            title: pr.pr_title,
            hoursOpen,
            reviewers,
            url: `https://github.com/${pr.repo_name}/pull/${pr.pr_github_number}`
          }
        );
        
        // Mark PR as reminded
        await db.pullRequests.markAsReminded(pr.pr_id);
        
        sent++;
      } catch (error) {
        console.error(`Error sending reminder for PR ${pr.pr_id}:`, error);
        failed++;
      }
    }
    
    return {
      success: true,
      total: stalePRs.length,
      sent,
      failed
    };
  } catch (error) {
    console.error('Error processing PR reminders:', error);
    throw error;
  }
};

/**
 * Setup a cron job to check for stale PRs
 * @param {Object} cronScheduler - Cron scheduler (node-cron)
 */
const setupReminderCron = (cronScheduler) => {
  // Run every hour
  cronScheduler.schedule('0 * * * *', async () => {
    console.log('Running PR reminder check...');
    
    try {
      const result = await processReminders();
      console.log('PR reminder check completed:', result);
    } catch (error) {
      console.error('Error running PR reminder check:', error);
    }
  });
};

module.exports = {
  processReminders,
  setupReminderCron
};
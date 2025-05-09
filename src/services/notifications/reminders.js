// src/services/notifications/reminders.js
const db = require('../supabase/functions');
const slackService = require('../slack/messages');
// const { WebClient } = require('@slack/web-api');
const cron = require('node-cron');

/**
 * Process and send reminders for stale PRs
 * @returns {Promise<Object>} Summary of processed reminders
 */
async function processReminders() {
  try {
    // Get list of stale PRs from Supabase function
    const stalePRs = await db.pullRequests.checkStalePRs();
    
    console.log(`Found ${stalePRs.length} stale PRs needing reminders`);
    
    let sent = 0;
    let failed = 0;
    const results = [];
    
    for (const pr of stalePRs) {
      try {
        // Skip PRs without reviewers
        if (!pr.reviewers || pr.reviewers.length === 0) {
          continue;
        }
        
        // Get full PR data to access more details
        const fullPR = await db.pullRequests.findById(pr.pr_id);
        if (!fullPR) continue;

        // Get repository data
        const repo = await db.repositories.findById(fullPR.repo_id);
        if (!repo) continue;
        
        // Calculate PR age in hours
        const createdAt = new Date(fullPR.created_at);
        const now = new Date();
        const hoursOpen = Math.round((now - createdAt) / (1000 * 60 * 60));
        const daysOpen = Math.floor(hoursOpen / 24);
        
        // Get review status counts
        const approvedReviewers = [];
        const changesRequestedReviewers = [];
        const pendingReviewers = [];
        
        // Parse reviewers JSON from db function
        const reviewerData = JSON.parse(pr.reviewers);
        
        // Get all review requests for status information
        const reviewRequests = await db.reviewRequests.getByPrId(pr.pr_id);
        
        for (const rr of reviewRequests) {
          const reviewer = await db.users.findById(rr.reviewer_id);
          if (!reviewer) continue;
          
          const reviewerInfo = {
            githubUsername: reviewer.github_username,
            slackUserId: reviewer.slack_user_id
          };
          
          if (rr.status === 'approved') {
            approvedReviewers.push(reviewerInfo);
          } else if (rr.status === 'changes_requested') {
            changesRequestedReviewers.push(reviewerInfo);
          } else if (rr.status === 'pending') {
            pendingReviewers.push(reviewerInfo);
          }
        }
        
        // Prepare reminder data
        const reminderData = {
          prId: pr.pr_id,
          prNumber: pr.pr_github_number,
          title: pr.pr_title,
          hoursOpen,
          daysOpen,
          reminderHours: pr.reminder_hours,
          approvedReviewers,
          changesRequestedReviewers,
          pendingReviewers,
          url: `https://github.com/${repo.github_repo_name}/pull/${pr.pr_github_number}`
        };
        
        // Send the reminder message
        await slackService.sendPrReminderMessage(
          pr.slack_bot_token,
          pr.slack_channel_id,
          reminderData
        );
        
        // Mark PR as reminded
        await db.pullRequests.markAsReminded(pr.pr_id);
        
        sent++;
        results.push({
          pr_id: pr.pr_id,
          status: 'sent',
          channel_id: pr.slack_channel_id
        });
      } catch (error) {
        console.error(`Error sending reminder for PR ${pr.pr_id}:`, error);
        failed++;
        results.push({
          pr_id: pr.pr_id,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      total: stalePRs.length,
      sent,
      failed,
      results
    };
  } catch (error) {
    console.error('Error processing PR reminders:', error);
    throw error;
  }
}

/**
 * Setup a cron job to check for stale PRs
 * @param {Object} app - Express app or server instance
 */
function setupReminderCron(app) {
  global.cronInitialized = true;
  // Track last run time to handle potential restarts
  let lastRunTime = new Date();
  lastRunTime.setHours(lastRunTime.getHours() - 1); // Initialize to run soon after startup
  
  // Check every 15 minutes if we need to run the hourly job
  cron.schedule('*/15 * * * *', async () => {
    global.lastReminderCheck = new Date().toISOString();
    const now = new Date();
    const hoursSinceLastRun = (now - lastRunTime) / (1000 * 60 * 60);
    
    // Only run if at least 50 minutes have passed since last run
    // This adds resilience if the service restarts
    if (hoursSinceLastRun >= 0.83) { // 50 minutes = 0.83 hours
      console.log(`[${now.toISOString()}] Running PR reminder check...`);
      
      try {
        const result = await processReminders();
        console.log(`PR reminders processed: ${result.sent} sent, ${result.failed} failed`);
        lastRunTime = now; // Update last run time
      } catch (error) {
        console.error('Error running PR reminder check:', error);
      }
    }
  });
  
  console.log('PR reminder check scheduled to run hourly');
}


module.exports = {
  processReminders,
  setupReminderCron
};
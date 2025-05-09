// src/services/cron/index.js
const db = require('../supabase/functions');
const slackService = require('../slack/messages');
const slackChannels = require('../slack/channels');
const { WebClient } = require('@slack/web-api');
const cron = require('node-cron');
const { supabase } = require('../supabase/client'); // Correct import

/**
 * Database functions for cron status tracking
 */
const cronStatus = {
  /**
   * Get the last run time for a specific cron job
   * @param {string} jobName - Name of the cron job
   * @returns {Promise<string|null>} ISO timestamp of last run or null
   */
  async getLastRunTime(jobName) {
    try {
      // Use imported supabase
      const { data, error } = await supabase
        .from('cron_status')
        .select('last_run_time')
        .eq('name', jobName)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.error(`Error getting last run time for ${jobName}:`, error);
        return null;
      }
      
      return data?.last_run_time;
    } catch (err) {
      console.error('Error in getLastRunTime:', err);
      return null;
    }
  },
  
  /**
   * Update the last run time for a specific cron job
   * @param {string} jobName - Name of the cron job
   * @returns {Promise<string>} Updated timestamp
   */
  async updateLastRunTime(jobName) {
    try {
      const now = new Date().toISOString();
      
      // Use imported supabase
      const { error } = await supabase
        .from('cron_status')
        .update({ last_run_time: now })
        .eq('name', jobName);
      
      if (error) {
        console.error(`Error updating last run time for ${jobName}:`, error);
        throw error;
      }
      
      return now;
    } catch (err) {
      console.error('Error in updateLastRunTime:', err);
      throw err;
    }
  }
};

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
        
        // Get all review requests for status information
        const reviewRequests = await db.pullRequests.getReviewRequests(pr.pr_id);
        
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


async function debugPrReminders() {
    try {
      // Get the PR reminders service
      const remindersService = require('../notifications/reminders');
      
      // Check if function exists
      if (typeof remindersService.processReminders !== 'function') {
        console.error('processReminders function not found in reminders service');
        return {
          success: false,
          error: 'processReminders function not found'
        };
      }
      
      // Run the process
      console.log('Calling processReminders...');
      const result = await remindersService.processReminders();
      console.log('processReminders result:', result);
      
      return result;
    } catch (error) {
      console.error('Error in debugPrReminders:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

/**
 * Process and archive channels for closed/merged PRs
 * @returns {Promise<Object>} Summary of processed archives
 */
async function processChannelArchives() {
    try {
      console.log('Starting channel archival process...');
      
      // Get list of channels to archive from database
      const channelsToArchive = await db.pullRequests.checkChannelsToArchive();
      
      if (!channelsToArchive || channelsToArchive.length === 0) {
        console.log('No channels found to archive');
        return {
          success: true,
          total: 0,
          archived: 0,
          failed: 0,
          results: []
        };
      }
      
      console.log(`Found ${channelsToArchive.length} channels to archive`);
      
      let archived = 0;
      let failed = 0;
      const results = [];
      
      for (const channel of channelsToArchive) {
        try {
          if (!channel.pr_id || !channel.slack_channel_id || !channel.slack_bot_token) {
            console.log('Skipping invalid channel data:', channel);
            continue;
          }
          
          console.log(`Processing channel ${channel.slack_channel_id} for PR ${channel.pr_id}`);
          
          // Get PR details for logging
          const pr = await db.pullRequests.findById(channel.pr_id);
          if (!pr) {
            console.log(`Skipping archive - PR ${channel.pr_id} not found`);
            continue;
          }
          
          // Send notification before archiving
          console.log('Sending notification before archiving...');
          const client = new WebClient(channel.slack_bot_token);
          
          await client.chat.postMessage({
            channel: channel.slack_channel_id,
            text: `This channel is being archived as the associated PR has been ${pr.status} for ${channel.days_since_closure} days.`
          });
          
          // Archive the channel
          console.log(`Archiving channel ${channel.slack_channel_id}...`);
          await slackChannels.archiveChannel(channel.slack_bot_token, channel.slack_channel_id);
          
          archived++;
          results.push({
            pr_id: channel.pr_id,
            channel_id: channel.slack_channel_id,
            status: 'archived'
          });
        } catch (error) {
          console.error(`Error archiving channel for PR ${channel.pr_id}:`, error);
          failed++;
          results.push({
            pr_id: channel.pr_id,
            channel_id: channel.slack_channel_id || 'unknown',
            status: 'failed',
            error: error.message
          });
        }
      }
      
      return {
        success: true,
        total: channelsToArchive.length,
        archived,
        failed,
        results
      };
    } catch (error) {
      console.error('Error processing channel archives:', error);
      throw error;
    }
  }

/**
 * Check if we should run a cron job based on last run time
 * @param {string} jobName - Name of the cron job
 * @param {number} intervalHours - Minimum interval in hours between runs
 * @returns {Promise<boolean>} Whether the job should run
 */
async function shouldRunCronJob(jobName, intervalHours = 1) {
  try {
    const lastRunTime = await cronStatus.getLastRunTime(jobName);
    const now = new Date();
    
    // If never run or if the interval has passed since last run
    if (!lastRunTime) {
      console.log(`${jobName} has never run before, running now`);
      return true;
    }
    
    const hoursSinceLastRun = (now - new Date(lastRunTime)) / (1000 * 60 * 60);
    console.log(`${jobName} last ran ${hoursSinceLastRun.toFixed(2)} hours ago`);
    
    return hoursSinceLastRun >= intervalHours;
  } catch (error) {
    console.error(`Error checking if ${jobName} should run:`, error);
    // Default to true if there's an error checking
    return true;
  }
}

/**
 * Setup cron jobs for the application
 */
function setupCronJobs() {
  // Track memory usage and initialization
  global.cronInitialized = true;
  global.cronLastCheck = {
    pr_reminder: null,
    channel_archival: null
  };
  
  // Log memory usage on startup
  const startupMemory = process.memoryUsage();
  console.log(
    `[CRON] Initial memory usage: ${Math.round(startupMemory.heapUsed / 1024 / 1024)}MB / ${Math.round(startupMemory.heapTotal / 1024 / 1024)}MB`
  );
  
  console.log('[CRON] Setting up cron jobs...');
  
  // PR Reminder job - Check every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    const now = new Date();
    global.cronLastCheck.pr_reminder = now.toISOString();
    
    console.log(`[${now.toISOString()}] Checking if PR reminders should run...`);
    
    try {
      // Log memory usage
      const memoryBefore = process.memoryUsage();
      console.log(
        `[CRON] Memory before PR reminder check: ${Math.round(memoryBefore.heapUsed / 1024 / 1024)}MB / ${Math.round(memoryBefore.heapTotal / 1024 / 1024)}MB`
      );
      
      // Check if we should run the job
      if (await shouldRunCronJob('pr_reminder', 0.83)) { // Run if at least 50 minutes since last run
        console.log('[CRON] Running PR reminders...');
        
        const result = await processReminders();
        console.log(`[CRON] PR reminders processed: ${result.sent} sent, ${result.failed} failed`);
        
        // Update last run time
        await cronStatus.updateLastRunTime('pr_reminder');
      } else {
        console.log('[CRON] Skipping PR reminders, ran recently');
      }
      
      // Log memory usage after
      const memoryAfter = process.memoryUsage();
      console.log(
        `[CRON] Memory after PR reminder check: ${Math.round(memoryAfter.heapUsed / 1024 / 1024)}MB / ${Math.round(memoryAfter.heapTotal / 1024 / 1024)}MB`
      );
    } catch (error) {
      console.error('[CRON] Error in PR reminder cron job:', error);
    }
  });
  
  // Channel Archival job - Check daily (at midnight)
  cron.schedule('0 0 * * *', async () => {
    const now = new Date();
    global.cronLastCheck.channel_archival = now.toISOString();
    
    console.log(`[${now.toISOString()}] Checking if channel archives should run...`);
    
    try {
      // Log memory usage
      const memoryBefore = process.memoryUsage();
      console.log(
        `[CRON] Memory before channel archival: ${Math.round(memoryBefore.heapUsed / 1024 / 1024)}MB / ${Math.round(memoryBefore.heapTotal / 1024 / 1024)}MB`
      );
      
      // Check if we should run the job
      if (await shouldRunCronJob('channel_archival', 23.5)) { // Run if at least 23.5 hours since last run
        console.log('[CRON] Running channel archival...');
        
        const result = await processChannelArchives();
        console.log(`[CRON] Channel archival processed: ${result.archived} archived, ${result.failed} failed`);
        
        // Update last run time
        await cronStatus.updateLastRunTime('channel_archival');
      } else {
        console.log('[CRON] Skipping channel archival, ran recently');
      }
      
      // Log memory usage after
      const memoryAfter = process.memoryUsage();
      console.log(
        `[CRON] Memory after channel archival: ${Math.round(memoryAfter.heapUsed / 1024 / 1024)}MB / ${Math.round(memoryAfter.heapTotal / 1024 / 1024)}MB`
      );
    } catch (error) {
      console.error('[CRON] Error in channel archival cron job:', error);
    }
  });
  
  console.log('[CRON] Cron jobs set up successfully');
}

/**
 * Add a health endpoint for cron status
 * @param {object} app - Express app
 */
function addCronHealthEndpoint(app) {
  app.get('/api/health/cron', async (req, res) => {
    try {
      const prReminderLastRun = await cronStatus.getLastRunTime('pr_reminder');
      const channelArchivalLastRun = await cronStatus.getLastRunTime('channel_archival');
      
      res.json({
        status: 'ok',
        initialized: !!global.cronInitialized,
        uptime: process.uptime(),
        memoryUsage: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        },
        jobs: {
          pr_reminder: {
            last_run: prReminderLastRun,
            last_check: global.cronLastCheck?.pr_reminder || null
          },
          channel_archival: {
            last_run: channelArchivalLastRun,
            last_check: global.cronLastCheck?.channel_archival || null
          }
        }
      });
    } catch (error) {
      console.error('Error in cron health endpoint:', error);
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  });
}

module.exports = {
  setupCronJobs,
  addCronHealthEndpoint,
  processReminders,
  processChannelArchives,
  debugPrReminders
};
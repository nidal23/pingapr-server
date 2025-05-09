/**
 * Health check routes
 */
const express = require('express');
const router = express.Router();
const { supabase } = require('../../services/supabase/client');
const pkg = require('../../../package.json');
const { addCronHealthEndpoint } = require('../../services/cron');
const cronDebug = require('../../services/cron/debug');

/**
 * Basic health check endpoint
 * GET /api/health
 */
router.get('/', async (req, res) => {
  res.json({
    status: 'ok',
    version: pkg.version,
    timestamp: new Date().toISOString()
  });
});


router.post('/debug-pr-reminders', async (req, res) => {
  try {
    const cronService = require('../../services/cron');
    const result = await cronService.debugPrReminders();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/debug-channel-archival', async (req, res) => {
  try {
    const cronService = require('../../services/cron');
    const result = await cronService.processChannelArchives();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/debug-stale-prs', async (req, res) => {
  try {
    const result = await cronDebug.debugCheckStalePRs();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/debug-channels-to-archive', async (req, res) => {
  try {
    const result = await cronDebug.debugCheckChannelsToArchive();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


addCronHealthEndpoint(router);

/**
 * Detailed health check endpoint
 * GET /api/health/detailed
 */
router.get('/detailed', async (req, res) => {
  let dbStatus = 'error';
  let dbLatency = null;
  
  try {
    // Check database connectivity with latency measurement
    const startTime = Date.now();
    const { data, error } = await supabase.from('migrations').select('count').limit(1);
    const endTime = Date.now();
    
    dbStatus = error ? 'error' : 'ok';
    dbLatency = endTime - startTime;
  } catch (error) {
    console.error('Health check error:', error);
  }
  
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    version: pkg.version,
    timestamp: new Date().toISOString(),
    services: {
      api: {
        status: 'ok',
        uptime: process.uptime()
      },
      database: {
        status: dbStatus,
        latency: dbLatency
      }
    }
  });
});

module.exports = router;
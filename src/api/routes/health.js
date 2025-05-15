/**
 * Health check routes
 */
const express = require('express');
const router = express.Router();
const { supabase } = require('../../services/supabase/client');
const { checkDatabaseHealth, verifyDatabaseStructure } = require('../../services/supabase/healthcheck');
const pkg = require('../../../package.json');
const { addCronHealthEndpoint } = require('../../services/cron');
const cronDebug = require('../../services/cron/debug');

/**
 * Basic health check endpoint
 * GET /api/health
 */
router.get('/', async (req, res) => {
  // Do a quick DB check but don't fail the health check if it's not successful
  try {
    const dbHealth = await checkDatabaseHealth();
    res.json({
      status: 'ok',
      version: pkg.version,
      database: dbHealth.status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Still return ok but indicate DB issue
    res.json({
      status: 'ok',
      version: pkg.version,
      database: 'error',
      timestamp: new Date().toISOString()
    });
  }
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
  try {
    // Check database connectivity with latency measurement
    const dbHealth = await checkDatabaseHealth();
    const dbStructure = await verifyDatabaseStructure();
    
    res.json({
      status: dbHealth.status === 'ok' && dbStructure.status === 'ok' ? 'ok' : 'degraded',
      version: pkg.version,
      timestamp: new Date().toISOString(),
      services: {
        api: {
          status: 'ok',
          uptime: process.uptime()
        },
        database: {
          status: dbHealth.status,
          latency: dbHealth.latency,
          structure: dbStructure.status,
          missingTables: dbStructure.missingTables
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      version: pkg.version,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;
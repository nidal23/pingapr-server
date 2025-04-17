/**
 * Health check routes
 */
const express = require('express');
const router = express.Router();
const { supabase } = require('../../services/supabase/client');
const pkg = require('../../../package.json');

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
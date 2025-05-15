// src/services/supabase/healthcheck.js
const { supabase } = require('./client');

/**
 * Check if the database connection is healthy
 * @returns {Promise<Object>} Health status object
 */
const checkDatabaseHealth = async () => {
  try {
    const startTime = Date.now();
    const { data, error } = await supabase.from('migrations').select('count').limit(1);
    const endTime = Date.now();
    
    if (error) {
      return {
        status: 'error',
        message: error.message,
        error
      };
    }
    
    return {
      status: 'ok',
      latency: endTime - startTime,
      message: 'Database connection is healthy'
    };
  } catch (error) {
    return {
      status: 'error',
      message: error.message,
      error
    };
  }
};

/**
 * Verify essential database tables exist
 * @returns {Promise<Object>} Verification result
 */
const verifyDatabaseStructure = async () => {
  const requiredTables = [
    'organizations',
    'repositories',
    'users',
    'pull_requests',
    'review_requests',
    'comments'
  ];
  
  const missingTables = [];
  const results = {};
  
  for (const table of requiredTables) {
    try {
      const { data, error } = await supabase
        .from('information_schema.tables')
        .select('*')
        .eq('table_name', table);
      
      if (error || !data || data.length === 0) {
        missingTables.push(table);
        results[table] = { exists: false, error: error?.message };
      } else {
        results[table] = { exists: true };
      }
    } catch (error) {
      missingTables.push(table);
      results[table] = { exists: false, error: error.message };
    }
  }
  
  return {
    status: missingTables.length === 0 ? 'ok' : 'error',
    missingTables,
    results
  };
};

module.exports = {
  checkDatabaseHealth,
  verifyDatabaseStructure
};
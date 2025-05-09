// src/services/cron/debug.js
const { supabase } = require('../supabase/client');


/**
 * Debug function to directly check stale PRs from the database
 */
async function debugCheckStalePRs() {
  try {
    const { data, error } = await supabase.rpc('check_stale_prs');
    
    if (error) {
      console.error('Error calling check_stale_prs function:', error);
      return { success: false, error: error.message };
    }
    
    return { 
      success: true, 
      count: data?.length || 0,
      data 
    };
  } catch (err) {
    console.error('Error in debugCheckStalePRs:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Debug function to directly check channels to archive from the database
 */
async function debugCheckChannelsToArchive() {
  try {
    const { data, error } = await supabase.rpc('check_channel_archival');
    
    if (error) {
      console.error('Error calling check_channel_archival function:', error);
      return { success: false, error: error.message };
    }
    
    return { 
      success: true, 
      count: data?.length || 0,
      data 
    };
  } catch (err) {
    console.error('Error in debugCheckChannelsToArchive:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  debugCheckStalePRs,
  debugCheckChannelsToArchive
};
// src/services/usage/index.js
const { supabase } = require('../supabase/client');
const { ApiError } = require('../../middleware/error');

/**
 * Usage tracking service for freemium pricing model
 */
const usageService = {
  /**
   * Check if organization can create a new PR (and increment counter if allowed)
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Object>} { allowed: boolean, reason?: string, usage?: Object }
   */
  async canCreatePR(orgId) {
    try {
      console.log(`[USAGE] Checking PR creation limit for org: ${orgId}`);
      
      // Call the database function to check and increment PR count
      const { data, error } = await supabase.rpc('increment_pr_count', {
        org_uuid: orgId
      });
      
      if (error) {
        console.error('[USAGE] Error checking PR limit:', error);
        // Fail open - if usage check fails, allow the PR
        return {
          allowed: true,
          reason: 'Usage check failed, allowing PR (fail-open policy)',
          error: error.message
        };
      }
      
      const allowed = data === true;
      
      if (!allowed) {
        console.log(`[USAGE] PR creation blocked for org ${orgId} - FREE tier limit reached`);
        
        // Get current usage stats for more detailed response
        const usage = await this.getUsageStats(orgId);
        
        return {
          allowed: false,
          reason: 'FREE tier monthly limit of 50 PRs reached. Upgrade to Professional for unlimited PRs.',
          usage
        };
      }
      
      console.log(`[USAGE] PR creation allowed for org ${orgId}`);
      return { allowed: true };
      
    } catch (error) {
      console.error('[USAGE] Exception in canCreatePR:', error);
      // Fail open - if there's an exception, allow the PR
      return {
        allowed: true,
        reason: 'Usage check failed, allowing PR (fail-open policy)',
        error: error.message
      };
    }
  },
  
  /**
   * Get current usage statistics for an organization
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Object>} Usage statistics
   */
  async getUsageStats(orgId) {
    try {
      console.log(`[USAGE] Getting usage stats for org: ${orgId}`);
      
      // Call the database function to get usage stats
      const { data, error } = await supabase.rpc('get_usage_stats', {
        org_uuid: orgId
      });
      
      if (error) {
        console.error('[USAGE] Error getting usage stats:', error);
        throw error;
      }
      
      if (!data) {
        throw new ApiError(404, 'Organization not found');
      }
      
      console.log(`[USAGE] Usage stats for org ${orgId}:`, data);
      return data;
      
    } catch (error) {
      console.error('[USAGE] Exception in getUsageStats:', error);
      throw error;
    }
  },
  
  /**
   * Check if organization can add more users
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Object>} { allowed: boolean, reason?: string, usage?: Object }
   */
  async canAddUser(orgId) {
    try {
      console.log(`[USAGE] Checking user limit for org: ${orgId}`);
      
      const usage = await this.getUsageStats(orgId);
      
      // Professional tier has no limits
      if (usage.subscription_tier === 'PROFESSIONAL') {
        return { allowed: true, usage };
      }
      
      // FREE tier is limited to 5 users
      if (usage.user_count >= 5) {
        return {
          allowed: false,
          reason: 'FREE tier is limited to 5 users. Upgrade to Professional for unlimited users.',
          usage
        };
      }
      
      return { allowed: true, usage };
      
    } catch (error) {
      console.error('[USAGE] Exception in canAddUser:', error);
      // Fail open for user addition as well
      return {
        allowed: true,
        reason: 'Usage check failed, allowing user addition (fail-open policy)',
        error: error.message
      };
    }
  },
  
  /**
   * Upgrade organization to Professional tier
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Object>} Updated organization
   */
  async upgradeToProfessional(orgId) {
    try {
      console.log(`[USAGE] Upgrading org ${orgId} to Professional tier`);
      
      const { data, error } = await supabase
        .from('organizations')
        .update({
          subscription_tier: 'PROFESSIONAL',
          updated_at: new Date().toISOString()
        })
        .eq('id', orgId)
        .select()
        .single();
      
      if (error) throw error;
      
      console.log(`[USAGE] Successfully upgraded org ${orgId} to Professional`);
      return data;
      
    } catch (error) {
      console.error('[USAGE] Error upgrading organization:', error);
      throw error;
    }
  },
  
  /**
   * Downgrade organization to FREE tier
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Object>} Updated organization
   */
  async downgradeToFree(orgId) {
    try {
      console.log(`[USAGE] Downgrading org ${orgId} to FREE tier`);
      
      const { data, error } = await supabase
        .from('organizations')
        .update({
          subscription_tier: 'FREE',
          updated_at: new Date().toISOString()
        })
        .eq('id', orgId)
        .select()
        .single();
      
      if (error) throw error;
      
      console.log(`[USAGE] Successfully downgraded org ${orgId} to FREE`);
      return data;
      
    } catch (error) {
      console.error('[USAGE] Error downgrading organization:', error);
      throw error;
    }
  },
  
  /**
   * Reset monthly PR count for an organization (admin function)
   * @param {string} orgId - Organization UUID
   * @returns {Promise<Object>} Updated organization
   */
  async resetMonthlyPRCount(orgId) {
    try {
      console.log(`[USAGE] Resetting monthly PR count for org: ${orgId}`);
      
      const currentMonthStart = new Date();
      currentMonthStart.setDate(1);
      currentMonthStart.setHours(0, 0, 0, 0);
      
      const { data, error } = await supabase
        .from('organizations')
        .update({
          monthly_pr_count: 0,
          pr_count_reset_date: currentMonthStart.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', orgId)
        .select()
        .single();
      
      if (error) throw error;
      
      console.log(`[USAGE] Successfully reset PR count for org ${orgId}`);
      return data;
      
    } catch (error) {
      console.error('[USAGE] Error resetting PR count:', error);
      throw error;
    }
  },
  
  /**
   * Get usage analytics for all organizations (admin function)
   * @returns {Promise<Array>} Usage analytics data
   */
  async getUsageAnalytics() {
    try {
      console.log('[USAGE] Getting usage analytics for all organizations');
      
      const { data, error } = await supabase
        .from('organizations')
        .select(`
          id,
          name,
          subscription_tier,
          monthly_pr_count,
          pr_count_reset_date,
          created_at
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Enhance with user counts
      const analytics = await Promise.all(
        data.map(async (org) => {
          try {
            const { data: users, error: userError } = await supabase
              .from('users')
              .select('id')
              .eq('org_id', org.id);
            
            const userCount = userError ? 0 : users.length;
            
            return {
              ...org,
              user_count: userCount,
              at_pr_limit: org.subscription_tier === 'FREE' && org.monthly_pr_count >= 50,
              at_user_limit: org.subscription_tier === 'FREE' && userCount >= 5
            };
          } catch (error) {
            console.error(`Error getting user count for org ${org.id}:`, error);
            return {
              ...org,
              user_count: 0,
              at_pr_limit: false,
              at_user_limit: false
            };
          }
        })
      );
      
      return analytics;
      
    } catch (error) {
      console.error('[USAGE] Error getting usage analytics:', error);
      throw error;
    }
  }
};

module.exports = usageService;
// src/api/controllers/onboarding/mapping.js
const { supabase } = require('../../../services/supabase/client')
// Save user mappings
const saveUserMappings = async (req, res, next) => {
    try {
      const orgId = req.organization.id;
      const { mappings } = req.body;
      
      if (!mappings || !Array.isArray(mappings)) {
        throw new ApiError(400, 'Invalid mappings format');
      }
      
      // Clear existing non-admin users for this organization
      await supabase
        .from('users')
        .delete()
        .eq('org_id', orgId)
        .eq('is_admin', false);
      
      // Create array of user objects for insert
      const usersToCreate = mappings.map(mapping => ({
        id: uuidv4(),
        org_id: orgId,
        github_username: mapping.githubUsername,
        slack_user_id: mapping.slackUserId,
        is_admin: !!mapping.isAdmin
      }));
      
      // Insert all users
      const { data, error } = await supabase
        .from('users')
        .insert(usersToCreate)
        .select();
      
      if (error) {
        throw error;
      }
      
      // Update admin_users array in organization
      const adminUsers = data.filter(user => user.is_admin).map(user => user.id);
      
      // Get existing admin (the current user)
      const { data: existingAdmin } = await supabase
        .from('users')
        .select('id')
        .eq('org_id', orgId)
        .eq('is_admin', true)
        .limit(1)
        .single();
      
      if (existingAdmin && !adminUsers.includes(existingAdmin.id)) {
        adminUsers.push(existingAdmin.id);
      }
      
      await supabase
        .from('organizations')
        .update({
          admin_users: adminUsers
        })
        .eq('id', orgId);
      
      res.json({
        success: true,
        users: data
      });
    } catch (error) {
      next(error);
    }
  };

module.exports = {
  saveUserMappings
};
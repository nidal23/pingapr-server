// src/services/auth.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('./supabase/client');
const config = require('../config');

const authService = {
  // Register a new user
  async register(name, email, password) {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existingUser) {
      throw new Error('User with this email already exists');
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate unique identifiers for pending values
    const uniqueId = uuidv4();
    const pendingGithubOrgId = `pending_${uniqueId}`;
    const pendingSlackWorkspaceId = `pending_${uniqueId}`;
    const pendingSlackBotToken = `pending_${uniqueId}`;
    const pendingGithubInstallationId = `pending_${uniqueId}`;
    
    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        id: uuidv4(),
        name: `${name}'s Organization`,
        github_org_id: pendingGithubOrgId,
        slack_workspace_id: pendingSlackWorkspaceId,
        slack_bot_token: pendingSlackBotToken,
        github_installation_id: pendingGithubInstallationId,
        admin_users: []
      })
      .select()
      .single();
    
    if (orgError) throw orgError;
    
    // Create user with a unique pending GitHub username
    const pendingGithubUsername = `pending_${uniqueId}`;
    
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        id: uuidv4(),
        org_id: org.id,
        name,
        email,
        password: hashedPassword,
        github_username: pendingGithubUsername,
        is_admin: true
      })
      .select('id, name, email, is_admin, org_id')
      .single();
    
    if (userError) throw userError;
    
    // Update organization with admin user
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        admin_users: [user.id]
      })
      .eq('id', org.id);
    
    if (updateError) throw updateError;
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.app.jwtSecret,
      { expiresIn: '7d' }
    );
    
    return { user, token };
  },
  
  // Login user
  async login(email, password) {
    // Find user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, password, is_admin, org_id')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      throw new Error('Invalid credentials');
    }
    
    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      throw new Error('Invalid credentials');
    }
    
    // Get organization
    const { data: org } = await supabase
      .from('organizations')
      .select('admin_users')
      .eq('id', user.org_id)
      .single();
    
    // Check admin status
    const isAdmin = org.admin_users?.includes(user.id) || user.is_admin;
    
    // Create JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.app.jwtSecret,
      { expiresIn: '7d' }
    );
    
    // Remove password from response
    delete user.password;
    
    // Include admin status
    user.is_admin = isAdmin;
    
    return { user, token };
  }
};

module.exports = authService;
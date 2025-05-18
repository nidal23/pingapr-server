// src/services/github/auth.js
const axios = require('axios');
const { supabase } = require('../supabase/client');
const db = require('../supabase/functions');
const config = require('../../config');
const logger = require('../../utils/formatting');

const githubAuth = {
  // Generate GitHub OAuth URL
  async getAuthUrl(userId, orgId) {
    // Create state parameter with user and org IDs
    const state = Buffer.from(JSON.stringify({
      userId,
      orgId
    })).toString('base64');
    
    // Build GitHub OAuth URL
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.append('client_id', config.github.clientId);
    url.searchParams.append('redirect_uri', config.github.redirectUri);
    url.searchParams.append('scope', 'repo user:email admin:org');
    url.searchParams.append('state', state);
    
    return url.toString();
  },

  async getInstallationUrl(orgId) {
    // State param for tracking the org after callback
    const state = Buffer.from(JSON.stringify({ orgId })).toString('base64');
    
    // URL to install the GitHub App
    const url = `https://github.com/apps/${config.github.appName}/installations/new?state=${state}`;
    
    return url;
  },

  // Handle installation callback
  async handleInstallation(installationId, state) {
    try {
      // Decode state to get orgId
      const { orgId } = JSON.parse(Buffer.from(state, 'base64').toString());
      
      // Create GitHub app auth
      const { Octokit } = await import('@octokit/rest');
      const { createAppAuth } = await import('@octokit/auth-app');
      
      const appOctokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.github.appId,
          privateKey: config.github.privateKey.replace(/\\n/g, '\n'),
          installationId
        }
      });
      
      // Get installation details
      const { data: installation } = await appOctokit.apps.getInstallation({
        installation_id: installationId
      });
      
      // Update organization record with GitHub details
      await supabase
        .from('organizations')
        .update({
          github_org_id: installation.account.id.toString(),
          github_installation_id: installationId.toString(),
          github_connected: true // Set the connection flag
        })
        .eq('id', orgId);
      
      // Get repositories from this installation
      const { data: repos } = await appOctokit.apps.listReposAccessibleToInstallation();
      
      // Store repositories
      for (const repo of repos.repositories) {
        await supabase
          .from('repositories')
          .upsert({
            org_id: orgId,
            github_repo_id: repo.id.toString(),
            github_repo_name: repo.full_name,
            is_active: true // Set active by default since admin explicitly selected them
          }, {
            onConflict: 'org_id, github_repo_id'
          });
      }
      
      return { success: true };
    } catch (error) {
      logger.safeErrorLog('handleInstallation', error, { installationId });
      throw error;
    }
  },


  /**
   * Validate GitHub credentials before storing
   * @param {string} accessToken - GitHub access token to validate
   * @returns {Promise<boolean>} True if valid, false otherwise
   */
  async validateGitHubCredentials(accessToken) {
    try {
      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: accessToken });
      
      // Test the token by making a simple API call
      const { data } = await octokit.users.getAuthenticated();
      
      // If we get here, the token is valid
      return {
        valid: true,
        username: data.login
      };
    } catch (error) {
      console.error('GitHub token validation failed:', {
        message: error.message,
        status: error.status
      });
      
      return {
        valid: false,
        error: error.message
      };
    }
  },
  
  // Exchange code for token
  async exchangeCodeForToken(code, state) {
    try {
      // Decode state
      const { userId, orgId } = JSON.parse(Buffer.from(state, 'base64').toString());
      
      // Exchange code for token
      const response = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code
      }, {
        headers: {
          Accept: 'application/json'
        }
      });
      
      if (!response.data.access_token) {
        throw new Error('Failed to get access token from GitHub');
      }
      
      const accessToken = response.data.access_token;

      const { valid, username, error: validationError } = await this.validateGitHubCredentials(accessToken);

      if (!valid) {
        throw new Error(`Failed to validate GitHub token: ${validationError}`);
      }
      
      // Get user info from GitHub
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `token ${accessToken}`
        }
      });
      
      const githubUser = userResponse.data;
      
      // Create or update GitHub connection
      
      // Update organization
      await supabase
        .from('organizations')
        .update({
          github_org_id: githubUser.login,
          github_installation_id: 'direct_oauth' // We're using direct OAuth instead of GitHub App
        })
        .eq('id', orgId);
      
      // Update user's GitHub username if needed
      await supabase
        .from('users')
        .update({
          github_username: githubUser.login
        })
        .eq('id', userId)
        .eq('github_username', 'pending');
      
      // Fetch repositories
      await this.fetchAndSaveRepositories(accessToken, orgId);
      
      return { success: true };
    } catch (error) {
      logger.safeErrorLog('exchangeCodeForToken', error, { code });
      throw error;
    }
  },

  async getInstallationToken(installationId) {
    try {      
      // Skip if not a valid installation ID
      if (!installationId || installationId === 'direct_oauth') {
        console.log('[GITHUB AUTH] No valid installation ID provided');
        return null;
      }
      
      const { createAppAuth } = await import('@octokit/auth-app');
      
      const auth = createAppAuth({
        appId: config.github.appId,
        privateKey: config.github.privateKey.replace(/\\n/g, '\n'),
        clientId: config.github.clientId,
        clientSecret: config.github.clientSecret
      });
      
      // Request an installation token
      const installationAuthentication = await auth({
        type: "installation",
        installationId
      });
      
      console.log(`[GITHUB AUTH] Successfully got installation token`);
      return installationAuthentication.token;
    } catch (error) {
      logger.safeErrorLog('getInstallationToken', error, { installationId });
      return null;
    }
  },

  /**
 * Get a valid token for GitHub API access
 * @param {string} orgId - Organization ID
 * @returns {Promise<string>} GitHub API token
 */
async  getAccessToken(orgId) {
  try {
    console.log(`[GITHUB AUTH] Getting access token for org: ${orgId}`);
    
    // Get organization details
    const { data: org } = await supabase
      .from('organizations')
      .select('github_installation_id')
      .eq('id', orgId)
      .single();
    
    if (!org) {
      console.log('[GITHUB AUTH] Organization not found');
      return null;
    }
    
    // Use installation token if available
    if (org.github_installation_id && org.github_installation_id !== 'direct_oauth') {
      // Use this.getInstallationToken instead of just getInstallationToken
      return await this.getInstallationToken(org.github_installation_id);
    }
    
    
    // Fallback to user token if no installation
    console.log('[GITHUB AUTH] No installation found, checking for user tokens');
    
    const { data: adminUsers } = await supabase
      .from('users')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_admin', true)
      .order('updated_at', { ascending: false });
    
    for (const admin of adminUsers || []) {
      if (admin.github_access_token) {
        const now = new Date();
        const expiresAt = new Date(admin.github_token_expires_at);
        
        if (expiresAt > now) {
          console.log(`[GITHUB AUTH] Using valid admin token`);
          return admin.github_access_token;
        }
      }
    }
    
    console.log('[GITHUB AUTH] No valid tokens found');
    return null;
  } catch (error) {
    logger.safeErrorLog('getAccessToken', error, { orgId });
    return null;
  }
},

async refreshGitHubToken(refreshTokenStr) {
  try {
    // Set up the request to GitHub's token endpoint
    const clientId = config.github.clientId;
    const clientSecret = config.github.clientSecret;
    
    // Call GitHub's token endpoint to get a new access token
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshTokenStr
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`GitHub token refresh error: ${data.error}`);
    }
    
    // Calculate expiry times
    const now = new Date();
    const expiresIn = data.expires_in || 8 * 60 * 60; // Default to 8 hours if not provided
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);
    
    // Parse refresh token expiry
    let refreshTokenExpiresAt = null;
    if (data.refresh_token_expires_in) {
      refreshTokenExpiresAt = new Date(now.getTime() + data.refresh_token_expires_in * 1000);
    }
    
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt.toISOString(),
      refresh_token_expires_at: refreshTokenExpiresAt ? refreshTokenExpiresAt.toISOString() : null
    };
  } catch (error) {
    logger.safeErrorLog('refreshGitHubToken', error, { refreshTokenStr });
    throw error;
  }
},
  
  // Fetch and save repositories
  async fetchAndSaveRepositories(accessToken, orgId) {
    try {
      const response = await axios.get('https://api.github.com/user/repos', {
        headers: {
          Authorization: `token ${accessToken}`
        },
        params: {
          sort: 'updated',
          per_page: 100
        }
      });
      
      const repos = response.data;
      
      // Save repositories to database
      for (const repo of repos) {
        await supabase
          .from('repositories')
          .upsert({
            org_id: orgId,
            github_repo_id: repo.id.toString(),
            github_repo_name: repo.full_name,
            is_active: false // Default to inactive, user will select which to monitor
          }, {
            onConflict: 'org_id, github_repo_id'
          });
      }
      
      return repos;
    } catch (error) {
      logger.safeErrorLog('fetchAndSaveRepositories', error, { orgId });
      throw error;
    }
  },

  // Add to your GitHub auth service
async getUsers(orgId) {
    try {
      // Get installation ID from database
      const { data: org } = await supabase
        .from('organizations')
        .select('github_installation_id')
        .eq('id', orgId)
        .single();
  
      if (!org?.github_installation_id) {
        throw new Error('GitHub installation not found');
      }
      const { Octokit } = await import('@octokit/rest');
      const { createAppAuth } = await import('@octokit/auth-app');

      // Create GitHub app auth
      const appOctokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.github.appId,
          privateKey: config.github.privateKey.replace(/\\n/g, '\n'),
          installationId: org.github_installation_id
        }
      });
      
      // Get repositories from this installation
      const { data: reposData } = await appOctokit.request('GET /installation/repositories');
      
      // Track unique users
      const usersMap = new Map();
      
      // For each repository, get contributors and collaborators
      for (const repo of reposData.repositories) {
        try {
          // Get contributors
          const { data: contributors } = await appOctokit.request('GET /repos/{owner}/{repo}/contributors', {
            owner: repo.owner.login,
            repo: repo.name
          });
          
          for (const contributor of contributors) {
            // Skip bots
            if (contributor.type !== 'User') continue;
            
            if (!usersMap.has(contributor.login)) {
              usersMap.set(contributor.login, {
                username: contributor.login,
                avatar_url: contributor.avatar_url,
                repos: [repo.name]
              });
            } else {
              usersMap.get(contributor.login).repos.push(repo.name);
            }
          }
          
          // Get collaborators if needed
          // This might hit rate limits, so consider if you really need this
          // const { data: collaborators } = await appOctokit.request('GET /repos/{owner}/{repo}/collaborators', {
          //   owner: repo.owner.login,
          //   repo: repo.name
          // });
          
          // Add more user details
          for (const [username, user] of usersMap.entries()) {
            if (!user.name) {
              try {
                const { data: userDetails } = await appOctokit.request('GET /users/{username}', {
                  username
                });
                user.name = userDetails.name || username;
                user.email = userDetails.email;
              } catch (error) {
                console.log(`Could not fetch details for user ${username}`);
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching users for ${repo.full_name}:`, error);
        }
      }
      
      return Array.from(usersMap.values());
    } catch (error) {
      logger.safeErrorLog('getUsers', error, { orgId });
      throw error;
    }
  },
  
  // Get repositories
  // Get repositories
async getRepositories(orgId) {
  try {
    // Get organization to check if GitHub is connected
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('github_connected')
      .eq('id', orgId)
      .single();
    
    if (orgError || !org.github_connected) {
      throw new Error('GitHub not connected');
    }
    
    // Get repositories from database
    const { data: repositories, error: reposError } = await supabase
      .from('repositories')
      .select('*')
      .eq('org_id', orgId);
    
    if (reposError) {
      throw reposError;
    }
    
    return repositories;
  } catch (error) {
    logger.safeErrorLog('getRepositories', error, { orgId });
    throw error;
  }
},
  
  // Toggle repository
  async toggleRepository(orgId, repoId, isActive) {
    try {
      const { data, error } = await supabase
        .from('repositories')
        .update({ is_active: isActive })
        .eq('org_id', orgId)
        .eq('github_repo_id', repoId)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      return data;
    } catch (error) {
      logger.safeErrorLog('toggleRepository', error, { repoId });
      throw error;
    }
  },

  /**
   * Check if a user's GitHub token is valid and refresh if expired
   * @param {Object} user - User object with token information
   * @returns {Promise<Object>} Object with { valid: boolean, token: string|null, message: string|null }
   */
  async validateAndRefreshUserToken(user) {
    try {
      // Extract token info from user
      const { 
        github_access_token: accessToken, 
        github_refresh_token: userRefreshToken,
        github_token_expires_at: expiresAt,
        id: userId
      } = user;
      
      // If no access token, cannot proceed
      if (!accessToken) {
        return { 
          valid: false, 
          token: null,
          message: "GitHub access token not found. Please reconnect your GitHub account."
        };
      }
      
      // Check if token is still valid
      const now = new Date();
      const tokenExpires = expiresAt ? new Date(expiresAt) : null;
      
      // Token is still valid
      if (!tokenExpires || tokenExpires > now) {
        // Verify token is actually working with GitHub API
        try {
          const { Octokit } = await import('@octokit/rest');
          const octokit = new Octokit({ auth: accessToken });
          await octokit.users.getAuthenticated();
          
          return { 
            valid: true, 
            token: accessToken,
            message: null
          };
        } catch (apiError) {
          logger.safeErrorLog('validateAndRefreshUserToken', error, { user });
          // Token doesn't work with API, try refreshing if possible
        }
      }
      // Token is expired or not working, attempt refresh if possible
      if (userRefreshToken) {
        try {
          console.log(`Attempting to refresh GitHub token for user: ${userId}`);
          
          
          // Use the refresh token to get a new access token
          const tokenData = await this.refreshGitHubToken(userRefreshToken);
          
          if (tokenData && tokenData.access_token) {
            // Update the user's token information in the database using the proper db method
            await db.users.update(userId, {
              github_access_token: tokenData.access_token,
              github_refresh_token: tokenData.refresh_towken || userRefreshToken,
              github_token_expires_at: tokenData.expires_at,
              github_refresh_token_expires_at: tokenData.refresh_token_expires_at,
              updated_at: new Date().toISOString()
            });
            
            console.log(`Successfully refreshed GitHub token for user: ${userId}`);
            return { 
              valid: true, 
              token: tokenData.access_token,
              message: null
            };
          }
        } catch (refreshError) {
          logger.safeErrorLog('token refresh error', error, { user });
          return { 
            valid: false, 
            token: null,
            message: "Your GitHub authentication has expired and couldn't be refreshed. Please reconnect your GitHub account."
          };
        }
      }
      
      // No refresh token or refresh failed
      return { 
        valid: false, 
        token: null,
        message: "Your GitHub authentication has expired. Please reconnect your GitHub account."
      };
    } catch (error) {
    logger.safeErrorLog('validateAndRefreshUserToken', error, { user });
      return { 
        valid: false, 
        token: null,
        message: "An error occurred validating your GitHub credentials. Please try again later."
      };
    }
  }
};

module.exports = githubAuth;
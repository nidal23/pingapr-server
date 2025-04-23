// src/services/github/auth.js
const axios = require('axios');
const { supabase } = require('../supabase/client');
const config = require('../../config');

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
    url.searchParams.append('redirect_uri', process.env.GITHUB_REDIRECT_URI);
    url.searchParams.append('scope', 'repo user:email admin:org');
    url.searchParams.append('state', state);
    
    return url.toString();
  },

  async getInstallationUrl(orgId) {
    // State param for tracking the org after callback
    const state = Buffer.from(JSON.stringify({ orgId })).toString('base64');
    
    // URL to install the GitHub App
    const url = `https://github.com/apps/${process.env.GITHUB_APP_NAME}/installations/new?state=${state}`;
    
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
          appId: process.env.GITHUB_APP_ID,
          privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
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
      console.error('Error handling installation:', error);
      throw error;
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
      console.error('Error exchanging code for token:', error);
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
      console.error('Error fetching repositories:', error);
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
          appId: process.env.GITHUB_APP_ID,
          privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
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
      console.error('Error getting GitHub users:', error);
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
    console.error('Error getting repositories:', error);
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
      console.error('Error toggling repository:', error);
      throw error;
    }
  }
};

module.exports = githubAuth;
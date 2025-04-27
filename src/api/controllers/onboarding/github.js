// src/api/controllers/onboarding/github.js
const db = require('../../../services/supabase/functions');
const { createAppAuth } = require('@octokit/auth-app');
const { Octokit } = require('@octokit/rest');
const config = require('../../../config');

// Redirect to GitHub App installation page
const installGitHubApp = (req, res) => {
  const { orgId } = req.user.org_id;
  
  if (!orgId) {
    return res.status(400).send('Missing organization ID');
  }
  
  // Store org ID in session
  req.session.orgId = orgId;
  
  // Redirect to GitHub app installation
  const installUrl = `https://github.com/apps/${config.github.appName}/installations/new`;
  res.redirect(`${installUrl}?state=${orgId}`);
};

// Handle GitHub App installation callback
const handleAppInstallCallback = async (req, res) => {
    try {
      const { installation_id } = req.query;
      const orgId = req.session.orgId;
      
      if (!installation_id || !orgId) {
        return res.status(400).send('Missing required parameters');
      }
      
      // Get installation details
      const auth = createAppAuth({
        appId: config.github.appId,
        privateKey: config.github.privateKey,
        clientId: config.github.clientId,
        clientSecret: config.github.clientSecret
      });
      
      const appOctokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.github.appId,
          privateKey: config.github.privateKey,
          installationId: installation_id
        }
      });
      
      // Get installation info
      const { data: installation } = await appOctokit.apps.getInstallation({
        installation_id
      });
      
      // Update organization with GitHub details
      await db.organizations.update(orgId, {
        github_org_id: installation.account.id.toString(),
        github_installation_id: installation_id
      });
      
      // Get repositories from this installation
      const { data: reposData } = await appOctokit.apps.listReposAccessibleToInstallation();
      
      // Create repository records
      for (const repo of reposData.repositories) {
        await db.repositories.upsert(orgId, repo.id.toString(), {
          github_repo_name: repo.full_name,
          is_active: true
        });
      }
      
      // // Create GitHub connection for the organization
      // await db.githubConnections.create({
      //   org_id: orgId,
      //   github_user_id: installation.account.id.toString(),
      //   github_username: installation.account.login,
      //   access_token: 'app_installation_token', // This is a placeholder as we're using app auth
      //   is_connected: true
      // });
      
      // Redirect to next step
      res.redirect(`/onboarding?step=slack&orgId=${orgId}`);
    } catch (error) {
      console.error('Error in GitHub install callback:', error);
      res.status(500).send('Error processing GitHub installation');
    }
  };
  

module.exports = {
  installGitHubApp,
  handleAppInstallCallback
};
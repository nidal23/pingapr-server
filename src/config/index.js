/**
 * Application configuration
 */
require('dotenv').config();

const config = {
  // Application settings
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 3000,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    sessionSecret: process.env.SESSION_SECRET || 'default-session-secret-dev-only',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-key'
  },
  
  // Supabase settings
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY
  },
  
  // GitHub App settings
  github: {
    appId: process.env.GITHUB_APP_ID,
    appName: process.env.GITHUB_APP_NAME || 'pingapr',
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    privateKey: process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Handle newlines in private key
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    redirectUri: process.env.GITHUB_REDIRECT_URI,
    userRedirectUri: process.env.GITHUB_USER_REDIRECT_URI
  },
  
  // Slack App settings
  slack: {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    redirectUri:process.env.SLACK_REDIRECT_URI,
    userRedirectUri: process.env.SLACK_USER_REDIRECT_URI
  },
  
  // Default settings for organizations
  defaults: {
    prReminderHours: 24,
    channelArchiveDays: 7
  }
};

// Validate critical configuration
const validateConfig = () => {
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'GITHUB_APP_ID',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'SLACK_CLIENT_ID',
    'SLACK_CLIENT_SECRET',
    'SLACK_SIGNING_SECRET'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.warn(`Missing required environment variables: ${missing.join(', ')}`);
    
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing required environment variables in production');
    }
  }
};

// Run validation if this is the main module
if (require.main === module) {
  validateConfig();
}

module.exports = config;
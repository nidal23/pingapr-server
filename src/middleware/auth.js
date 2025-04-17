/**
 * Authentication middleware
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ApiError } = require('./error');
const config = require('../config');
const { supabase } = require('../services/supabase/client');

/**
 * Verify GitHub webhook signature
 * Uses the webhook secret to verify the request is from GitHub
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const verifyGitHubWebhook = (req, res, next) => {
    try {
      // Check for signature
      const signature = req.headers['x-hub-signature-256'];
      
      if (!signature) {
        throw new ApiError(401, 'Missing GitHub signature');
      }
      
      // In development, you might skip verification
      if (process.env.NODE_ENV === 'development' && process.env.SKIP_GITHUB_VERIFICATION === 'true') {
        return next();
      }
      
      // Verify signature
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
      const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
      
      if (signature !== digest) {
        throw new ApiError(401, 'Invalid GitHub signature');
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
  

/**
 * Verify JWT and attach user to request
 */
const verifyJWT = async (req, res, next) => {
    try {
      // Get token from header
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ApiError(401, 'No token provided');
      }
      
      const token = authHeader.replace('Bearer ', '');
      
      // Verify token
      const decoded = jwt.verify(token, config.app.jwtSecret);
      
      // Get user from database
      const { data: user, error } = await supabase
        .from('users')
        .select('id, name, email, is_admin, org_id')
        .eq('id', decoded.userId)
        .single();
      
      if (error || !user) {
        throw new ApiError(401, 'Invalid token');
      }
      
      // Get organization
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', user.org_id)
        .single();
      
      if (orgError) {
        throw new ApiError(401, 'Invalid organization');
      }
      
      // Check if user is in admin_users array
      const isAdmin = org.admin_users?.includes(user.id) || user.is_admin;
      
      // Add user and org to request
      req.user = user;
      req.user.isAdmin = isAdmin;
      req.organization = org;
      
      next();
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
      } else if (error.name === 'JsonWebTokenError') {
        next(new ApiError(401, 'Invalid token'));
      } else if (error.name === 'TokenExpiredError') {
        next(new ApiError(401, 'Token expired'));
      } else {
        next(new ApiError(401, 'Authentication failed'));
      }
    }
  };
  
  


/**
 * Ensure user is authenticated as admin
 */
const ensureAdmin = (req, res, next) => {
    try {
      // Check if user is admin
      if (!req.user || !req.user.isAdmin) {
        throw new ApiError(403, 'Admin access required');
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };

/**
 * Verify Slack request signature
 * Uses the signing secret to verify the request is from Slack
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const verifySlackRequest = (req, res, next) => {
  // Skip verification in test environment
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  
  try {
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];
    
    if (!signature || !timestamp) {
      throw new ApiError(401, 'Missing Slack signature headers');
    }
    
    // Verify timestamp is recent to prevent replay attacks
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      throw new ApiError(401, 'Slack request timestamp is too old');
    }
    
    // Get the raw body
    const rawBody = JSON.stringify(req.body);
    
    // Create the signature base string
    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    
    // Calculate expected signature
    const hmac = crypto.createHmac('sha256', config.slack.signingSecret);
    const digest = 'v0=' + hmac.update(sigBasestring).digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
      throw new ApiError(401, 'Invalid Slack signature');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};
/**
 * Ensure user is authenticated
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const ensureAuthenticated = (req, res, next) => {
  try {
    // Check if user session exists
    if (!req.session.user) {
      throw new ApiError(401, 'Authentication required');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};


const authMiddleware = async (req, res, next) => {
    try {
      // Get token from header
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }
      
      const token = authHeader.split(' ')[1];
      
      // Verify token
      const decoded = jwt.verify(token, config.app.jwtSecret);
      
      // Get user from database
      const { data: user, error } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('id', decoded.userId)
        .single();
      
      if (error || !user) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      // Add user to request
      req.user = user;
      
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(401).json({ error: 'Invalid token' });
    }
  };

module.exports = {
  verifyGitHubWebhook,
  verifyJWT,
  verifySlackRequest,
  ensureAdmin,
  ensureAuthenticated,
  authMiddleware
};
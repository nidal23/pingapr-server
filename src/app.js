/**
 * Express application setup
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const { errorHandler } = require('./middleware/error');
const { apiLimiter } = require('./middleware/rate-limit');
const { requestTimeout } = require('./middleware/timeout');


// Critical security check for production
if (process.env.NODE_ENV === 'production') {
  if (process.env.SKIP_GITHUB_VERIFICATION === 'true' || process.env.SKIP_SLACK_VERIFICATION === 'true') {
    console.error('CRITICAL SECURITY ERROR: Webhook verification bypass is enabled in production!');
    process.exit(1); // Stop the server if verification is bypassed in production
  }
}

// Create Express app
const app = express();

// Basic middleware
app.use(helmet({
    // Disable contentSecurityPolicy for development
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
  })); 
  app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL 
      : ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));app.use(morgan('dev')); // HTTP request logging
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies


app.use(requestTimeout(30000)); // 30 second timeout

// Session management
app.use(session({
  secret: config.app.sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: config.app.env === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Static files
if (config.app.env === 'production') {
  app.use(express.static(path.join(__dirname, '../public')));
}

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

const authRoutes = require('./api/routes/auth');
const healthRoutes = require('./api/routes/health');
const githubRoutes = require('./api/routes/github');
const slackRoutes = require('./api/routes/slack');
const onboardingRoutes = require('./api/routes/onboarding')
const dashboardRoutes = require('./api/routes/dashboard')

// API routes
// app.use('/api/health', require('./api/routes/health'));
// app.use('/api/github', require('./api/routes/github'));
// app.use('/api/slack', require('./api/routes/slack'));
// app.use('/api/admin', require('./api/routes/admin.js'));
// app.use('/api/onboarding', require('./api/routes/onboarding'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/dashboard', dashboardRoutes)

// Serve React app in production
if (config.app.env === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
  });
}

// Error handling middleware
app.use(errorHandler);

module.exports = app;
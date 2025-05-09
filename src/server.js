// src/server.js
const app = require('./app');
const config = require('./config');
const { supabase } = require('./services/supabase/client');
const { setupCronJobs } = require('./services/cron');

const PORT = config.app.port;

// Start the server
async function startServer() {
  try {
    // Check Supabase connection
    const { data, error } = await supabase.from('migrations').select('count');
    
    if (error) {
      console.warn('Database connection warning:', error.message);
      console.log('Continuing startup anyway...');
    } else {
      console.log('Database connection successful');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${config.app.env}`);
      
      // Set up cron jobs after server is started
      setupCronJobs();
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
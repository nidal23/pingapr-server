// src/middleware/timeout.js
/**
 * Request timeout middleware
 * Sets a timeout for requests and ensures a proper response is sent
 * 
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Function} Express middleware function
 */
const requestTimeout = (timeout = 25000) => {
  return (req, res, next) => {
    // Skip timeout for webhook endpoints
    if (req.path.includes('/webhook') || req.path.includes('/events') || req.path.includes('/commands')) {
      return next();
    }
    
    // Set a timeout
    req.setTimeout(timeout, () => {
      if (!res.headersSent) {
        console.error(`Request timeout: ${req.method} ${req.originalUrl}`);
        res.status(503).json({
          error: 'Request timed out. Please try again later.'
        });
      }
    });
    
    next();
  };
};

module.exports = {
  requestTimeout
};
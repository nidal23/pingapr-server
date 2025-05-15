// src/utils/logging.js
/**
 * Safely logs an error without potentially exposing sensitive information
 * @param {string} context - Where the error occurred
 * @param {Error} error - The error object
 * @param {Object} additionalInfo - Any additional context info
 */
const safeErrorLog = (context, error, additionalInfo = {}) => {
  // Extract only safe properties to log
  const safeError = {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status,
    // Don't include stack traces in production
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
  };
  
  // Log the sanitized error with context
  console.error(`Error in ${context}:`, safeError, additionalInfo);
};

/**
 * Logs information safely
 */
const info = (message, data = {}) => {
  console.log(message, data);
};

module.exports = {
  safeErrorLog,
  info
};
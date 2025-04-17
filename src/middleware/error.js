// src/middleware/error.js
class ApiError extends Error {
    constructor(statusCode, message, details = null) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
      this.name = this.constructor.name;
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  const notFoundHandler = (req, res, next) => {
    const error = new ApiError(404, `Resource not found: ${req.originalUrl}`);
    next(error);
  };
  
  const errorHandler = (err, req, res, next) => {
    // Get status code and message
    const statusCode = err.statusCode || 500;
    
    // Create error response
    const errorResponse = {
      error: {
        message: err.message || 'Internal Server Error',
        ...(err.details && { details: err.details })
      }
    };
    
    // Add stack trace in development mode
    if (process.env.NODE_ENV !== 'production' && err.stack) {
      errorResponse.error.stack = err.stack;
    }
    
    // Log error
    console.error(`[ERROR] ${statusCode} - ${err.message}`);
    if (statusCode === 500) {
      console.error(err.stack);
    }
    
    // Send error response
    res.status(statusCode).json(errorResponse);
  };
  
  module.exports = {
    ApiError,
    notFoundHandler,
    errorHandler
  };
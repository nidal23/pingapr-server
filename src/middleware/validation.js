// src/middleware/validation.js
const { ApiError } = require('./error');

/**
 * Factory function to create a validation middleware
 * @param {Object} schema - Joi schema for request validation
 * @param {string} property - Which part of the request to validate (body, params, query)
 * @returns {Function} Express middleware function
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error } = schema.validate(req[property]);
    if (!error) return next();

    const errorMessage = error.details.map(detail => detail.message).join(', ');
    next(new ApiError(400, errorMessage));
  };
};

module.exports = {
  validate
};
// src/validation/auth.js
const Joi = require('joi');

// Registration validation schema
const registerSchema = Joi.object({
  name: Joi.string().trim().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required()
});

// Login validation schema
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Update identities validation schema
const updateIdentitiesSchema = Joi.object({
  githubUsername: Joi.string().required(),
  slackUserId: Joi.string().required(),
  avatarUrl: Joi.string().optional()
});

module.exports = {
  registerSchema,
  loginSchema,
  updateIdentitiesSchema
};
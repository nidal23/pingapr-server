// src/api/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');
const { validate } = require('../../middleware/validation');
const { registerSchema, loginSchema, updateIdentitiesSchema } = require('../validation/auth')
const { verifyJWT } = require('../../middleware/auth');
const { authLimiter } = require('../../middleware/rate-limit');

// Public routes with validation
router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);

// Protected routes with validation
router.get('/me', verifyJWT, authController.getCurrentUser);
router.post('/update-identities', verifyJWT, validate(updateIdentitiesSchema), authController.updateUserIdentities);

module.exports = router;
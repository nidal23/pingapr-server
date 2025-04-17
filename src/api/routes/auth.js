// src/api/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');
const { verifyJWT } = require('../../middleware/auth');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected routes
router.get('/me', verifyJWT, authController.getCurrentUser);

module.exports = router;
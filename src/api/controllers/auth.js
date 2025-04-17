// src/api/controllers/auth.js
const { ApiError } = require('../../middleware/error');
const authService = require('../../services/auth');

// Register new user
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      throw new ApiError(400, 'Name, email, and password are required');
    }
    
    const { user, token } = await authService.register(name, email, password);
    
    res.status(201).json({
      message: 'User registered successfully',
      user,
      token
    });
  } catch (error) {
    next(error);
  }
};

// Login existing user
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      throw new ApiError(400, 'Email and password are required');
    }
    
    const { user, token } = await authService.login(email, password);
    
    res.json({
      message: 'Login successful',
      user,
      token
    });
  } catch (error) {
    next(error);
  }
};

// Get current user
const getCurrentUser = async (req, res, next) => {
  try {
    // User is already attached to request by verifyJWT middleware
    res.json({ user: req.user });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getCurrentUser
};
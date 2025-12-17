/**
 * Authentication Routes
 * Handles user registration, login, token refresh, and password management
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { authenticate, generateAccessToken, generateRefreshToken, verifyRefreshToken,
    trackLoginAttempt, isAccountLocked, rateLimit } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validator');
const config = require('../config');

// Will be injected from server.js
let db = null;
const setDb = (database) => { db = database; };

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register',
    rateLimit(10, 60 * 60 * 1000), // 10 registrations per hour
    validate(schemas.register),
    async (req, res) => {
        try {
            const { email, password, name, role, department, phone } = req.body;

            // Check if user already exists
            const existingUser = db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already registered',
                    code: 'EMAIL_EXISTS'
                });
            }

            // Hash password
            const salt = await bcrypt.genSalt(config.security.bcryptRounds);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Create user
            const result = db.run(`
                INSERT INTO users (email, password, name, role, department, phone)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [email, hashedPassword, name, role, department || null, phone || null]);

            const user = {
                id: result.lastInsertRowid,
                email,
                name,
                role,
                department
            };

            // Generate tokens
            const accessToken = generateAccessToken(user);
            const refreshToken = generateRefreshToken(user);

            // Store refresh token
            db.run(`
                INSERT INTO refresh_tokens (user_id, token, expires_at)
                VALUES (?, ?, datetime('now', '+7 days'))
            `, [user.id, refreshToken]);

            // Log activity
            db.run(`
                INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, 'user_registered', 'user', ?, 'New user registration')
            `, [user.id, user.id]);

            res.status(201).json({
                success: true,
                message: 'Registration successful',
                user,
                accessToken,
                refreshToken
            });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ success: false, message: 'Registration failed' });
        }
    }
);

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 */
router.post('/login',
    rateLimit(config.rateLimit.authMaxRequests, config.rateLimit.authWindowMs),
    validate(schemas.login),
    async (req, res) => {
        try {
            const { email, password } = req.body;

            // Check if account is locked
            const lockStatus = isAccountLocked(email);
            if (lockStatus.locked) {
                return res.status(423).json({
                    success: false,
                    message: lockStatus.message,
                    code: 'ACCOUNT_LOCKED',
                    retryAfter: lockStatus.remainingSeconds
                });
            }

            // Find user
            const user = db.get('SELECT * FROM users WHERE email = ?', [email]);

            if (!user) {
                trackLoginAttempt(email, false);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                    code: 'INVALID_CREDENTIALS'
                });
            }

            // Verify password
            const isValidPassword = await bcrypt.compare(password, user.password);

            if (!isValidPassword) {
                const attemptResult = trackLoginAttempt(email, false);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                    code: 'INVALID_CREDENTIALS',
                    attemptsRemaining: attemptResult.attemptsRemaining
                });
            }

            // Clear login attempts on success
            trackLoginAttempt(email, true);

            // Generate tokens
            const userData = { id: user.id, email: user.email, name: user.name, role: user.role };
            const accessToken = generateAccessToken(userData);
            const refreshToken = generateRefreshToken(userData);

            // Store refresh token
            db.run(`
                INSERT INTO refresh_tokens (user_id, token, expires_at)
                VALUES (?, ?, datetime('now', '+7 days'))
            `, [user.id, refreshToken]);

            // Log activity
            db.run(`
                INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, 'user_login', 'user', ?, 'User logged in')
            `, [user.id, user.id]);

            res.json({
                success: true,
                message: 'Login successful',
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    department: user.department
                },
                accessToken,
                refreshToken
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ success: false, message: 'Login failed' });
        }
    }
);

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token required',
                code: 'MISSING_REFRESH_TOKEN'
            });
        }

        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired refresh token',
                code: 'INVALID_REFRESH_TOKEN'
            });
        }

        // Check if token exists in database
        const storedToken = db.get(`
            SELECT * FROM refresh_tokens 
            WHERE user_id = ? AND token = ? AND expires_at > datetime('now')
        `, [decoded.id, refreshToken]);

        if (!storedToken) {
            return res.status(401).json({
                success: false,
                message: 'Refresh token not found or expired',
                code: 'TOKEN_NOT_FOUND'
            });
        }

        // Get user
        const user = db.get('SELECT id, email, name, role FROM users WHERE id = ?', [decoded.id]);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Generate new access token
        const newAccessToken = generateAccessToken(user);

        res.json({
            success: true,
            accessToken: newAccessToken
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ success: false, message: 'Token refresh failed' });
    }
});

/**
 * POST /api/auth/logout
 * Invalidate refresh token
 */
router.post('/logout', authenticate, (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (refreshToken) {
            db.run('DELETE FROM refresh_tokens WHERE user_id = ? AND token = ?',
                [req.user.id, refreshToken]);
        } else {
            // Logout from all devices
            db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [req.user.id]);
        }

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ success: false, message: 'Logout failed' });
    }
});

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post('/change-password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current and new password required'
            });
        }

        // Get user with password
        const user = db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(config.security.bcryptRounds);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

        // Invalidate all refresh tokens
        db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [req.user.id]);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ success: false, message: 'Password change failed' });
    }
});

/**
 * GET /api/auth/profile
 * Get current user profile
 */
router.get('/profile', authenticate, (req, res) => {
    try {
        const user = db.get(`
            SELECT id, email, name, role, department, phone, created_at
            FROM users WHERE id = ?
        `, [req.user.id]);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get profile' });
    }
});

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put('/profile', authenticate, (req, res) => {
    try {
        const { name, department, phone } = req.body;

        db.run(`
            UPDATE users SET name = COALESCE(?, name), department = COALESCE(?, department), 
            phone = COALESCE(?, phone) WHERE id = ?
        `, [name, department, phone, req.user.id]);

        const user = db.get(`
            SELECT id, email, name, role, department, phone FROM users WHERE id = ?
        `, [req.user.id]);

        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

module.exports = { router, setDb };

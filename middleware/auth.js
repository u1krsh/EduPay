/**
 * Authentication Middleware
 * JWT verification, role-based access control, and rate limiting
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

// Rate limiting store (in-memory for simplicity, use Redis in production)
const rateLimitStore = new Map();
const loginAttempts = new Map();

/**
 * JWT Authentication Middleware
 * Verifies the access token and attaches user info to request
 */
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Access token required',
            code: 'MISSING_TOKEN'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.jwt.secret, {
            issuer: config.jwt.issuer,
            audience: config.jwt.audience
        });

        req.user = decoded;
        req.token = token;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid token',
            code: 'INVALID_TOKEN'
        });
    }
}

/**
 * Optional Authentication Middleware
 * Attaches user info if token is valid, but doesn't require it
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            req.user = jwt.verify(token, config.jwt.secret);
            req.token = token;
        } catch (error) {
            // Token invalid, but that's okay for optional auth
        }
    }
    next();
}

/**
 * Role-Based Access Control Middleware Factory
 * @param {string[]} allowedRoles - Array of roles allowed to access the route
 */
function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
                code: 'FORBIDDEN'
            });
        }

        next();
    };
}

/**
 * Rate Limiting Middleware Factory
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 */
function rateLimit(maxRequests = 100, windowMs = 15 * 60 * 1000) {
    if (!config.features.enableRateLimiting) {
        return (req, res, next) => next();
    }

    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();

        if (!rateLimitStore.has(key)) {
            rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }

        const record = rateLimitStore.get(key);

        if (now > record.resetTime) {
            // Window expired, reset
            rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }

        if (record.count >= maxRequests) {
            const retryAfter = Math.ceil((record.resetTime - now) / 1000);
            res.set('Retry-After', retryAfter);
            return res.status(429).json({
                success: false,
                message: 'Too many requests, please try again later',
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter
            });
        }

        record.count++;
        next();
    };
}

/**
 * Login Attempt Tracker
 * Tracks failed login attempts and implements account lockout
 */
function trackLoginAttempt(email, success) {
    const now = Date.now();

    if (!loginAttempts.has(email)) {
        loginAttempts.set(email, { attempts: 0, lockUntil: null });
    }

    const record = loginAttempts.get(email);

    if (success) {
        // Reset on successful login
        loginAttempts.delete(email);
        return { locked: false };
    }

    // Check if currently locked
    if (record.lockUntil && now < record.lockUntil) {
        const remainingSeconds = Math.ceil((record.lockUntil - now) / 1000);
        return {
            locked: true,
            remainingSeconds,
            message: `Account temporarily locked. Try again in ${Math.ceil(remainingSeconds / 60)} minutes.`
        };
    }

    // Increment failed attempts
    record.attempts++;

    if (record.attempts >= config.security.maxLoginAttempts) {
        record.lockUntil = now + config.security.lockoutDuration;
        record.attempts = 0;
        return {
            locked: true,
            remainingSeconds: Math.ceil(config.security.lockoutDuration / 1000),
            message: `Too many failed attempts. Account locked for ${Math.ceil(config.security.lockoutDuration / 60000)} minutes.`
        };
    }

    return {
        locked: false,
        attemptsRemaining: config.security.maxLoginAttempts - record.attempts
    };
}

/**
 * Check if account is locked
 */
function isAccountLocked(email) {
    const record = loginAttempts.get(email);
    if (!record || !record.lockUntil) return { locked: false };

    if (Date.now() < record.lockUntil) {
        const remainingSeconds = Math.ceil((record.lockUntil - Date.now()) / 1000);
        return {
            locked: true,
            remainingSeconds,
            message: `Account temporarily locked. Try again in ${Math.ceil(remainingSeconds / 60)} minutes.`
        };
    }

    // Lock expired
    loginAttempts.delete(email);
    return { locked: false };
}

/**
 * Request Logging Middleware
 */
function requestLogger(req, res, next) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userId: req.user?.id || 'anonymous'
        };

        if (config.server.env === 'development') {
            console.log(`📡 ${log.method} ${log.path} ${log.status} - ${log.duration}`);
        }
    });

    next();
}

/**
 * Generate JWT Access Token
 */
function generateAccessToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
        },
        config.jwt.secret,
        {
            expiresIn: config.jwt.accessTokenExpiry,
            issuer: config.jwt.issuer,
            audience: config.jwt.audience
        }
    );
}

/**
 * Generate JWT Refresh Token
 */
function generateRefreshToken(user) {
    return jwt.sign(
        { id: user.id, type: 'refresh' },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshTokenExpiry }
    );
}

/**
 * Verify Refresh Token
 */
function verifyRefreshToken(token) {
    try {
        return jwt.verify(token, config.jwt.refreshSecret);
    } catch (error) {
        return null;
    }
}

// Cleanup expired rate limit entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetTime) {
            rateLimitStore.delete(key);
        }
    }
    for (const [key, record] of loginAttempts.entries()) {
        if (record.lockUntil && now > record.lockUntil) {
            loginAttempts.delete(key);
        }
    }
}, 60000); // Cleanup every minute

module.exports = {
    authenticate,
    optionalAuth,
    authorize,
    rateLimit,
    trackLoginAttempt,
    isAccountLocked,
    requestLogger,
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken
};

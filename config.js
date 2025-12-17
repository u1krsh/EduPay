/**
 * Application Configuration
 * Centralized configuration management for the Professor Payment Platform
 */

const path = require('path');

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || 3000,
        env: process.env.NODE_ENV || 'development',
        host: process.env.HOST || 'localhost'
    },

    // Database Configuration
    database: {
        path: process.env.DB_PATH || path.join(__dirname, 'platform.db'),
        backupPath: process.env.DB_BACKUP_PATH || path.join(__dirname, 'backups')
    },

    // JWT Configuration
    jwt: {
        secret: process.env.JWT_SECRET || 'edupay-super-secret-key-2024-change-in-production',
        refreshSecret: process.env.JWT_REFRESH_SECRET || 'edupay-refresh-secret-key-2024-change-in-production',
        accessTokenExpiry: '15m',
        refreshTokenExpiry: '7d',
        issuer: 'EduPay Platform',
        audience: 'EduPay Users'
    },

    // Rate Limiting
    rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 100, // Limit each IP to 100 requests per window
        authWindowMs: 60 * 60 * 1000, // 1 hour for auth endpoints
        authMaxRequests: 5 // 5 login attempts per hour
    },

    // Security Settings
    security: {
        bcryptRounds: 10,
        passwordMinLength: 8,
        sessionTimeout: 30 * 60 * 1000, // 30 minutes
        maxLoginAttempts: 5,
        lockoutDuration: 15 * 60 * 1000 // 15 minutes
    },

    // Notification Settings
    notifications: {
        maxPerUser: 100, // Maximum notifications stored per user
        autoDeleteAfterDays: 30,
        emailEnabled: process.env.EMAIL_ENABLED === 'true',
        smtp: {
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT) || 587,
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
        }
    },

    // Payment Settings
    payment: {
        defaultCurrency: 'INR',
        currencySymbol: '₹',
        taxRate: 0.18, // 18% GST
        paymentCycleDays: 30,
        invoicePrefix: 'EDU-INV',
        minPayoutAmount: 1000
    },

    // Analytics Settings
    analytics: {
        retentionDays: 365,
        aggregationInterval: 'daily'
    },

    // Feature Flags
    features: {
        enableNotifications: true,
        enableSMS: false,
        enableInvoicing: true,
        enableAnalytics: true,
        enableAuditLog: true,
        enableRateLimiting: true,
        requireEmailVerification: false,
        enableRecurringSessions: true
    },

    // CORS Settings
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: true
    }
};

// Validate critical configurations
function validateConfig() {
    const errors = [];

    if (config.server.env === 'production') {
        if (config.jwt.secret.includes('change-in-production')) {
            errors.push('JWT secret must be changed in production');
        }
        if (config.jwt.refreshSecret.includes('change-in-production')) {
            errors.push('JWT refresh secret must be changed in production');
        }
    }

    if (errors.length > 0) {
        console.error('⚠️ Configuration Errors:');
        errors.forEach(err => console.error(`  - ${err}`));
        if (config.server.env === 'production') {
            process.exit(1);
        }
    }
}

validateConfig();

module.exports = config;

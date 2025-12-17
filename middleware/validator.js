/**
 * Input Validation Middleware
 * Request validation and sanitization
 */

/**
 * Common validation patterns
 */
const patterns = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    phone: /^[+]?[\d\s-]{10,15}$/,
    password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
    date: /^\d{4}-\d{2}-\d{2}$/,
    time: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
};

/**
 * Sanitize string input
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str.trim()
        .replace(/[<>]/g, '') // Remove potential HTML tags
        .substring(0, 10000); // Limit length
}

/**
 * Sanitize object recursively
 */
function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            sanitized[key] = sanitizeString(value);
        } else if (Array.isArray(value)) {
            sanitized[key] = value.map(item =>
                typeof item === 'string' ? sanitizeString(item) : sanitizeObject(item)
            );
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

/**
 * Validation rule builders
 */
const validators = {
    required: (value, fieldName) => {
        if (value === undefined || value === null || value === '') {
            return { valid: false, message: `${fieldName} is required` };
        }
        return { valid: true };
    },

    string: (value, fieldName, { minLength = 0, maxLength = 10000 } = {}) => {
        if (typeof value !== 'string') {
            return { valid: false, message: `${fieldName} must be a string` };
        }
        if (value.length < minLength) {
            return { valid: false, message: `${fieldName} must be at least ${minLength} characters` };
        }
        if (value.length > maxLength) {
            return { valid: false, message: `${fieldName} must be at most ${maxLength} characters` };
        }
        return { valid: true };
    },

    number: (value, fieldName, { min, max } = {}) => {
        const num = Number(value);
        if (isNaN(num)) {
            return { valid: false, message: `${fieldName} must be a number` };
        }
        if (min !== undefined && num < min) {
            return { valid: false, message: `${fieldName} must be at least ${min}` };
        }
        if (max !== undefined && num > max) {
            return { valid: false, message: `${fieldName} must be at most ${max}` };
        }
        return { valid: true };
    },

    email: (value, fieldName) => {
        if (!patterns.email.test(value)) {
            return { valid: false, message: `${fieldName} must be a valid email address` };
        }
        return { valid: true };
    },

    phone: (value, fieldName) => {
        if (!patterns.phone.test(value)) {
            return { valid: false, message: `${fieldName} must be a valid phone number` };
        }
        return { valid: true };
    },

    password: (value, fieldName) => {
        if (value.length < 8) {
            return { valid: false, message: `${fieldName} must be at least 8 characters` };
        }
        if (!/[a-z]/.test(value)) {
            return { valid: false, message: `${fieldName} must contain a lowercase letter` };
        }
        if (!/[A-Z]/.test(value)) {
            return { valid: false, message: `${fieldName} must contain an uppercase letter` };
        }
        if (!/\d/.test(value)) {
            return { valid: false, message: `${fieldName} must contain a number` };
        }
        return { valid: true };
    },

    date: (value, fieldName) => {
        if (!patterns.date.test(value)) {
            return { valid: false, message: `${fieldName} must be in YYYY-MM-DD format` };
        }
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            return { valid: false, message: `${fieldName} is not a valid date` };
        }
        return { valid: true };
    },

    time: (value, fieldName) => {
        if (!patterns.time.test(value)) {
            return { valid: false, message: `${fieldName} must be in HH:MM format` };
        }
        return { valid: true };
    },

    enum: (value, fieldName, allowedValues) => {
        if (!allowedValues.includes(value)) {
            return { valid: false, message: `${fieldName} must be one of: ${allowedValues.join(', ')}` };
        }
        return { valid: true };
    },

    array: (value, fieldName, { minLength = 0, maxLength = 1000 } = {}) => {
        if (!Array.isArray(value)) {
            return { valid: false, message: `${fieldName} must be an array` };
        }
        if (value.length < minLength) {
            return { valid: false, message: `${fieldName} must have at least ${minLength} items` };
        }
        if (value.length > maxLength) {
            return { valid: false, message: `${fieldName} must have at most ${maxLength} items` };
        }
        return { valid: true };
    },

    integer: (value, fieldName, options = {}) => {
        const num = Number(value);
        if (!Number.isInteger(num)) {
            return { valid: false, message: `${fieldName} must be an integer` };
        }
        return validators.number(num, fieldName, options);
    }
};

/**
 * Create validation middleware from schema
 * @param {Object} schema - Validation schema
 */
function validate(schema) {
    return (req, res, next) => {
        const errors = [];

        // Sanitize request body
        if (req.body) {
            req.body = sanitizeObject(req.body);
        }

        // Validate each field in schema
        for (const [field, rules] of Object.entries(schema)) {
            const value = getNestedValue(req.body, field);

            // Check if required
            if (rules.required) {
                const result = validators.required(value, field);
                if (!result.valid) {
                    errors.push(result.message);
                    continue;
                }
            } else if (value === undefined || value === null || value === '') {
                continue; // Skip optional empty fields
            }

            // Run type validator
            if (rules.type && validators[rules.type]) {
                const result = validators[rules.type](value, field, rules);
                if (!result.valid) {
                    errors.push(result.message);
                }
            }

            // Run enum validator
            if (rules.enum) {
                const result = validators.enum(value, field, rules.enum);
                if (!result.valid) {
                    errors.push(result.message);
                }
            }

            // Run custom validator
            if (rules.custom) {
                const result = rules.custom(value, req.body);
                if (!result.valid) {
                    errors.push(result.message);
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors
            });
        }

        next();
    };
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) =>
        current && current[key] !== undefined ? current[key] : undefined, obj);
}

/**
 * Validate query parameters middleware
 */
function validateQuery(schema) {
    return (req, res, next) => {
        const errors = [];

        for (const [param, rules] of Object.entries(schema)) {
            let value = req.query[param];

            // Type coercion for query params
            if (value !== undefined && rules.type === 'number') {
                value = Number(value);
                req.query[param] = value;
            }
            if (value !== undefined && rules.type === 'integer') {
                value = parseInt(value, 10);
                req.query[param] = value;
            }
            if (value !== undefined && rules.type === 'boolean') {
                value = value === 'true' || value === '1';
                req.query[param] = value;
            }

            if (rules.required && (value === undefined || value === '')) {
                errors.push(`Query parameter '${param}' is required`);
                continue;
            }

            if (value !== undefined && value !== '' && rules.type && validators[rules.type]) {
                const result = validators[rules.type](value, param, rules);
                if (!result.valid) {
                    errors.push(result.message);
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Query validation failed',
                errors
            });
        }

        next();
    };
}

/**
 * Validate URL parameters middleware
 */
function validateParams(schema) {
    return (req, res, next) => {
        const errors = [];

        for (const [param, rules] of Object.entries(schema)) {
            let value = req.params[param];

            // Type coercion
            if (value !== undefined && (rules.type === 'number' || rules.type === 'integer')) {
                value = parseInt(value, 10);
                req.params[param] = value;
            }

            if (rules.required && (value === undefined || value === '')) {
                errors.push(`URL parameter '${param}' is required`);
                continue;
            }

            if (value !== undefined && rules.type && validators[rules.type]) {
                const result = validators[rules.type](value, param, rules);
                if (!result.valid) {
                    errors.push(result.message);
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Parameter validation failed',
                errors
            });
        }

        next();
    };
}

// Common validation schemas
const schemas = {
    login: {
        email: { required: true, type: 'email' },
        password: { required: true, type: 'string', minLength: 1 }
    },

    register: {
        email: { required: true, type: 'email' },
        password: { required: true, type: 'password' },
        name: { required: true, type: 'string', minLength: 2, maxLength: 100 },
        role: { required: true, enum: ['professor', 'admin'] },
        department: { type: 'string', maxLength: 100 },
        phone: { type: 'phone' }
    },

    createSession: {
        date: { required: true, type: 'date' },
        start_time: { type: 'time' },
        end_time: { type: 'time' },
        duration_hours: { required: true, type: 'number', min: 0.5, max: 12 },
        topic: { required: true, type: 'string', minLength: 3, maxLength: 200 },
        course_name: { type: 'string', maxLength: 50 },
        rate_per_hour: { required: true, type: 'number', min: 0 }
    },

    updateSession: {
        date: { type: 'date' },
        start_time: { type: 'time' },
        end_time: { type: 'time' },
        duration_hours: { type: 'number', min: 0.5, max: 12 },
        topic: { type: 'string', minLength: 3, maxLength: 200 },
        course_name: { type: 'string', maxLength: 50 },
        rate_per_hour: { type: 'number', min: 0 },
        notes: { type: 'string', maxLength: 1000 }
    },

    createDispute: {
        sessionId: { required: true, type: 'integer' },
        reason: { required: true, type: 'string', minLength: 5, maxLength: 100 },
        description: { type: 'string', maxLength: 2000 }
    },

    pagination: {
        page: { type: 'integer', min: 1 },
        limit: { type: 'integer', min: 1, max: 100 }
    }
};

module.exports = {
    validate,
    validateQuery,
    validateParams,
    validators,
    schemas,
    sanitizeString,
    sanitizeObject,
    patterns
};

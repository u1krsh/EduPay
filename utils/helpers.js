/**
 * Utility Helpers
 * Common utility functions for the application
 */

const crypto = require('crypto');
const config = require('../config');

/**
 * Date Formatting Utilities
 */
const dateUtils = {
    /**
     * Format date to readable string
     */
    formatDate(date, options = {}) {
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;

        const defaultOptions = {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            ...options
        };

        return d.toLocaleDateString('en-IN', defaultOptions);
    },

    /**
     * Format date to ISO string (YYYY-MM-DD)
     */
    toISODate(date) {
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    },

    /**
     * Format datetime to readable string
     */
    formatDateTime(date) {
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;

        return d.toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Get relative time string (e.g., "2 hours ago")
     */
    timeAgo(date) {
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;

        const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
        if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
        return dateUtils.formatDate(d);
    },

    /**
     * Get start of month
     */
    startOfMonth(date = new Date()) {
        const d = new Date(date);
        return new Date(d.getFullYear(), d.getMonth(), 1);
    },

    /**
     * Get end of month
     */
    endOfMonth(date = new Date()) {
        const d = new Date(date);
        return new Date(d.getFullYear(), d.getMonth() + 1, 0);
    },

    /**
     * Get date range for period
     */
    getPeriodRange(period) {
        const now = new Date();
        let start, end;

        switch (period) {
            case 'today':
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                break;
            case 'week':
                const dayOfWeek = now.getDay();
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
                end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - dayOfWeek));
                break;
            case 'month':
                start = dateUtils.startOfMonth(now);
                end = dateUtils.endOfMonth(now);
                break;
            case 'quarter':
                const quarter = Math.floor(now.getMonth() / 3);
                start = new Date(now.getFullYear(), quarter * 3, 1);
                end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
                break;
            case 'year':
                start = new Date(now.getFullYear(), 0, 1);
                end = new Date(now.getFullYear(), 11, 31);
                break;
            default:
                start = dateUtils.startOfMonth(now);
                end = dateUtils.endOfMonth(now);
        }

        return {
            start: dateUtils.toISODate(start),
            end: dateUtils.toISODate(end)
        };
    },

    /**
     * Parse duration in hours to readable format
     */
    formatDuration(hours) {
        if (!hours || hours <= 0) return '0 hrs';
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        if (m === 0) return `${h} hr${h !== 1 ? 's' : ''}`;
        if (h === 0) return `${m} min`;
        return `${h} hr${h !== 1 ? 's' : ''} ${m} min`;
    }
};

/**
 * Currency Formatting Utilities
 */
const currencyUtils = {
    /**
     * Format amount to currency string
     */
    format(amount, currency = config.payment.defaultCurrency) {
        const num = Number(amount) || 0;
        const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency;

        return symbol + new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(num);
    },

    /**
     * Parse currency string to number
     */
    parse(currencyStr) {
        if (typeof currencyStr === 'number') return currencyStr;
        return parseFloat(currencyStr.replace(/[^0-9.-]/g, '')) || 0;
    },

    /**
     * Calculate tax amount
     */
    calculateTax(amount, taxRate = config.payment.taxRate) {
        const num = Number(amount) || 0;
        return Math.round(num * taxRate * 100) / 100;
    },

    /**
     * Calculate total with tax
     */
    calculateTotalWithTax(amount, taxRate = config.payment.taxRate) {
        const num = Number(amount) || 0;
        const tax = currencyUtils.calculateTax(num, taxRate);
        return {
            subtotal: num,
            tax,
            total: num + tax,
            taxRate
        };
    },

    /**
     * Round to nearest paisa (2 decimal places)
     */
    round(amount) {
        return Math.round(Number(amount) * 100) / 100;
    }
};

/**
 * String Utilities
 */
const stringUtils = {
    /**
     * Generate random string
     */
    randomString(length = 16) {
        return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
    },

    /**
     * Generate UUID v4
     */
    uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    },

    /**
     * Truncate string with ellipsis
     */
    truncate(str, maxLength = 100) {
        if (!str || str.length <= maxLength) return str;
        return str.substring(0, maxLength - 3) + '...';
    },

    /**
     * Capitalize first letter
     */
    capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    },

    /**
     * Convert string to title case
     */
    titleCase(str) {
        if (!str) return '';
        return str.split(' ').map(word => stringUtils.capitalize(word)).join(' ');
    },

    /**
     * Get initials from name
     */
    getInitials(name, maxLength = 2) {
        if (!name) return '';
        return name
            .split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .slice(0, maxLength)
            .join('');
    },

    /**
     * Slugify string
     */
    slug(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    },

    /**
     * Mask sensitive data
     */
    mask(str, visibleChars = 4, maskChar = '*') {
        if (!str || str.length <= visibleChars) return str;
        return maskChar.repeat(str.length - visibleChars) + str.slice(-visibleChars);
    },

    /**
     * Mask email address
     */
    maskEmail(email) {
        if (!email || !email.includes('@')) return email;
        const [local, domain] = email.split('@');
        const maskedLocal = local.charAt(0) + '*'.repeat(Math.max(local.length - 2, 1)) + local.slice(-1);
        return maskedLocal + '@' + domain;
    }
};

/**
 * Number Utilities
 */
const numberUtils = {
    /**
     * Format number with thousand separators
     */
    format(num) {
        return new Intl.NumberFormat('en-IN').format(Number(num) || 0);
    },

    /**
     * Calculate percentage
     */
    percentage(value, total

    ) {
        if (!total || total === 0) return 0;
        return Math.round((value / total) * 100 * 100) / 100;
    },

    /**
     * Clamp number between min and max
     */
    clamp(num, min, max) {
        return Math.min(Math.max(Number(num) || 0, min), max);
    },

    /**
     * Parse integer safely
     */
    parseInt(value, defaultValue = 0) {
        const num = parseInt(value, 10);
        return isNaN(num) ? defaultValue : num;
    },

    /**
     * Parse float safely
     */
    parseFloat(value, defaultValue = 0) {
        const num = parseFloat(value);
        return isNaN(num) ? defaultValue : num;
    }
};

/**
 * Object Utilities
 */
const objectUtils = {
    /**
     * Pick specific keys from object
     */
    pick(obj, keys) {
        if (!obj) return {};
        return keys.reduce((acc, key) => {
            if (obj.hasOwnProperty(key)) {
                acc[key] = obj[key];
            }
            return acc;
        }, {});
    },

    /**
     * Omit specific keys from object
     */
    omit(obj, keys) {
        if (!obj) return {};
        return Object.keys(obj)
            .filter(key => !keys.includes(key))
            .reduce((acc, key) => {
                acc[key] = obj[key];
                return acc;
            }, {});
    },

    /**
     * Deep clone object
     */
    clone(obj) {
        if (!obj) return obj;
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Check if object is empty
     */
    isEmpty(obj) {
        return !obj || Object.keys(obj).length === 0;
    },

    /**
     * Remove null/undefined values from object
     */
    compact(obj) {
        if (!obj) return {};
        return Object.entries(obj)
            .filter(([_, value]) => value !== null && value !== undefined)
            .reduce((acc, [key, value]) => {
                acc[key] = value;
                return acc;
            }, {});
    }
};

/**
 * Array Utilities
 */
const arrayUtils = {
    /**
     * Group array by key
     */
    groupBy(arr, key) {
        if (!Array.isArray(arr)) return {};
        return arr.reduce((acc, item) => {
            const group = item[key];
            if (!acc[group]) acc[group] = [];
            acc[group].push(item);
            return acc;
        }, {});
    },

    /**
     * Sum array of numbers or objects by key
     */
    sum(arr, key = null) {
        if (!Array.isArray(arr)) return 0;
        return arr.reduce((sum, item) => {
            const value = key ? Number(item[key]) || 0 : Number(item) || 0;
            return sum + value;
        }, 0);
    },

    /**
     * Calculate average
     */
    average(arr, key = null) {
        if (!Array.isArray(arr) || arr.length === 0) return 0;
        return arrayUtils.sum(arr, key) / arr.length;
    },

    /**
     * Remove duplicates by key
     */
    uniqueBy(arr, key) {
        if (!Array.isArray(arr)) return [];
        const seen = new Set();
        return arr.filter(item => {
            const value = item[key];
            if (seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    },

    /**
     * Sort array by key
     */
    sortBy(arr, key, order = 'asc') {
        if (!Array.isArray(arr)) return [];
        return [...arr].sort((a, b) => {
            const aVal = a[key];
            const bVal = b[key];
            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return order === 'desc' ? -comparison : comparison;
        });
    },

    /**
     * Chunk array into groups
     */
    chunk(arr, size) {
        if (!Array.isArray(arr)) return [];
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }
};

/**
 * Pagination Utilities
 */
const paginationUtils = {
    /**
     * Calculate pagination metadata
     */
    paginate(totalItems, page = 1, limit = 10) {
        const totalPages = Math.ceil(totalItems / limit);
        const currentPage = numberUtils.clamp(page, 1, totalPages || 1);
        const offset = (currentPage - 1) * limit;

        return {
            currentPage,
            totalPages,
            totalItems,
            limit,
            offset,
            hasNext: currentPage < totalPages,
            hasPrev: currentPage > 1,
            nextPage: currentPage < totalPages ? currentPage + 1 : null,
            prevPage: currentPage > 1 ? currentPage - 1 : null
        };
    },

    /**
     * Create pagination response
     */
    response(data, pagination) {
        return {
            data,
            pagination: {
                page: pagination.currentPage,
                limit: pagination.limit,
                totalItems: pagination.totalItems,
                totalPages: pagination.totalPages,
                hasNext: pagination.hasNext,
                hasPrev: pagination.hasPrev
            }
        };
    }
};

/**
 * Generate Invoice Number
 */
function generateInvoiceNumber(prefix = config.payment.invoicePrefix) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${prefix}-${year}${month}-${random}`;
}

/**
 * Generate Transaction Reference
 */
function generateTransactionRef() {
    const date = new Date();
    const timestamp = date.getTime().toString(36).toUpperCase();
    const random = stringUtils.randomString(6).toUpperCase();
    return `TXN-${timestamp}-${random}`;
}

/**
 * Hash sensitive data (for comparison, not passwords)
 */
function hash(data) {
    return crypto.createHash('sha256').update(String(data)).digest('hex');
}

/**
 * Sleep utility for async operations
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry utility for unreliable operations
 */
async function retry(fn, options = {}) {
    const { attempts = 3, delay = 1000, backoff = 2 } = options;

    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === attempts - 1) throw error;
            await sleep(delay * Math.pow(backoff, i));
        }
    }
}

module.exports = {
    dateUtils,
    currencyUtils,
    stringUtils,
    numberUtils,
    objectUtils,
    arrayUtils,
    paginationUtils,
    generateInvoiceNumber,
    generateTransactionRef,
    hash,
    sleep,
    retry
};

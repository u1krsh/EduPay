/**
 * Notification Service
 * Handles notification creation, delivery, and real-time updates via SSE
 */

const { get, all, run } = require('../database');
const config = require('../config');
const { stringUtils, dateUtils } = require('../utils/helpers');

// Store active SSE connections
const sseConnections = new Map();

/**
 * Notification Types
 */
const NOTIFICATION_TYPES = {
    SESSION_APPROVED: 'session_approved',
    SESSION_REJECTED: 'session_rejected',
    SESSION_PENDING: 'session_pending',
    PAYMENT_SCHEDULED: 'payment_scheduled',
    PAYMENT_PROCESSED: 'payment_processed',
    DISPUTE_CREATED: 'dispute_created',
    DISPUTE_RESOLVED: 'dispute_resolved',
    SYSTEM_ANNOUNCEMENT: 'system_announcement',
    REMINDER: 'reminder'
};

/**
 * Notification Templates
 */
const TEMPLATES = {
    [NOTIFICATION_TYPES.SESSION_APPROVED]: {
        title: 'Session Approved',
        icon: 'check_circle',
        color: '#10b981'
    },
    [NOTIFICATION_TYPES.SESSION_REJECTED]: {
        title: 'Session Rejected',
        icon: 'cancel',
        color: '#ef4444'
    },
    [NOTIFICATION_TYPES.SESSION_PENDING]: {
        title: 'New Session Pending',
        icon: 'pending',
        color: '#f59e0b'
    },
    [NOTIFICATION_TYPES.PAYMENT_SCHEDULED]: {
        title: 'Payment Scheduled',
        icon: 'schedule',
        color: '#3b82f6'
    },
    [NOTIFICATION_TYPES.PAYMENT_PROCESSED]: {
        title: 'Payment Processed',
        icon: 'payments',
        color: '#10b981'
    },
    [NOTIFICATION_TYPES.DISPUTE_CREATED]: {
        title: 'Dispute Created',
        icon: 'warning',
        color: '#f59e0b'
    },
    [NOTIFICATION_TYPES.DISPUTE_RESOLVED]: {
        title: 'Dispute Resolved',
        icon: 'gavel',
        color: '#10b981'
    },
    [NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT]: {
        title: 'System Announcement',
        icon: 'campaign',
        color: '#6366f1'
    },
    [NOTIFICATION_TYPES.REMINDER]: {
        title: 'Reminder',
        icon: 'notifications',
        color: '#8b5cf6'
    }
};

/**
 * Create a notification
 */
function createNotification({ userId, type, message, data = null, priority = 'normal' }) {
    if (!config.features.enableNotifications) return null;

    const template = TEMPLATES[type] || TEMPLATES[NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT];

    const result = run(`
        INSERT INTO notifications (user_id, type, title, message, icon, color, data, priority, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
        userId,
        type,
        template.title,
        message,
        template.icon,
        template.color,
        data ? JSON.stringify(data) : null,
        priority
    ]);

    const notification = {
        id: result.lastInsertRowid,
        user_id: userId,
        type,
        title: template.title,
        message,
        icon: template.icon,
        color: template.color,
        data: data ? JSON.parse(JSON.stringify(data)) : null,
        priority,
        is_read: false,
        created_at: new Date().toISOString()
    };

    // Send real-time notification via SSE
    sendToUser(userId, 'notification', notification);

    return notification;
}

/**
 * Create notification for multiple users
 */
function notifyUsers(userIds, notificationData) {
    const notifications = [];
    for (const userId of userIds) {
        const notification = createNotification({
            ...notificationData,
            userId
        });
        if (notification) {
            notifications.push(notification);
        }
    }
    return notifications;
}

/**
 * Get notifications for a user
 */
function getUserNotifications(userId, options = {}) {
    const { limit = 50, offset = 0, unreadOnly = false } = options;

    let query = `
        SELECT * FROM notifications 
        WHERE user_id = ?
    `;

    if (unreadOnly) {
        query += ` AND is_read = 0`;
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    const notifications = all(query, [userId, limit, offset]);

    return notifications.map(n => ({
        ...n,
        data: n.data ? JSON.parse(n.data) : null,
        is_read: Boolean(n.is_read),
        time_ago: dateUtils.timeAgo(n.created_at)
    }));
}

/**
 * Get unread notification count
 */
function getUnreadCount(userId) {
    const result = get(`
        SELECT COUNT(*) as count FROM notifications 
        WHERE user_id = ? AND is_read = 0
    `, [userId]);

    return result?.count || 0;
}

/**
 * Mark notification as read
 */
function markAsRead(notificationId, userId) {
    run(`
        UPDATE notifications 
        SET is_read = 1, read_at = datetime('now')
        WHERE id = ? AND user_id = ?
    `, [notificationId, userId]);

    // Send update via SSE
    sendToUser(userId, 'notification_read', { id: notificationId });

    return true;
}

/**
 * Mark all notifications as read for a user
 */
function markAllAsRead(userId) {
    run(`
        UPDATE notifications 
        SET is_read = 1, read_at = datetime('now')
        WHERE user_id = ? AND is_read = 0
    `, [userId]);

    sendToUser(userId, 'all_notifications_read', {});

    return true;
}

/**
 * Delete a notification
 */
function deleteNotification(notificationId, userId) {
    run(`
        DELETE FROM notifications 
        WHERE id = ? AND user_id = ?
    `, [notificationId, userId]);

    return true;
}

/**
 * Delete old notifications (cleanup)
 */
function cleanupOldNotifications() {
    const retentionDays = config.notifications.autoDeleteAfterDays;

    run(`
        DELETE FROM notifications 
        WHERE created_at < datetime('now', '-${retentionDays} days')
    `);

    // Also trim excess notifications per user
    const users = all(`SELECT DISTINCT user_id FROM notifications`);
    const maxPerUser = config.notifications.maxPerUser;

    for (const { user_id } of users) {
        run(`
            DELETE FROM notifications 
            WHERE user_id = ? AND id NOT IN (
                SELECT id FROM notifications 
                WHERE user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            )
        `, [user_id, user_id, maxPerUser]);
    }

    console.log('🧹 Notification cleanup completed');
}

// ============== SSE (Server-Sent Events) ==============

/**
 * Register SSE connection for a user
 */
function registerSSEConnection(userId, res) {
    // Setup SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ userId, timestamp: Date.now() })}\n\n`);

    // Store connection
    if (!sseConnections.has(userId)) {
        sseConnections.set(userId, new Set());
    }
    sseConnections.get(userId).add(res);

    console.log(`📡 SSE connection established for user ${userId}`);

    // Handle client disconnect
    res.on('close', () => {
        const userConnections = sseConnections.get(userId);
        if (userConnections) {
            userConnections.delete(res);
            if (userConnections.size === 0) {
                sseConnections.delete(userId);
            }
        }
        console.log(`📡 SSE connection closed for user ${userId}`);
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
        res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 30000);

    res.on('close', () => clearInterval(heartbeat));
}

/**
 * Send event to a specific user via SSE
 */
function sendToUser(userId, event, data) {
    const connections = sseConnections.get(userId);
    if (!connections || connections.size === 0) return;

    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const res of connections) {
        try {
            res.write(message);
        } catch (error) {
            connections.delete(res);
        }
    }
}

/**
 * Broadcast event to all connected users
 */
function broadcast(event, data, filter = null) {
    for (const [userId, connections] of sseConnections.entries()) {
        if (filter && !filter(userId)) continue;

        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

        for (const res of connections) {
            try {
                res.write(message);
            } catch (error) {
                connections.delete(res);
            }
        }
    }
}

/**
 * Broadcast to all admins
 */
function broadcastToAdmins(event, data) {
    // Get all admin user IDs
    const admins = all(`SELECT id FROM users WHERE role = 'admin'`);
    const adminIds = new Set(admins.map(a => a.id));

    broadcast(event, data, userId => adminIds.has(userId));
}

/**
 * Get SSE stats
 */
function getSSEStats() {
    let totalConnections = 0;
    for (const connections of sseConnections.values()) {
        totalConnections += connections.size;
    }

    return {
        activeUsers: sseConnections.size,
        totalConnections
    };
}

// Cleanup old notifications periodically (every hour)
setInterval(cleanupOldNotifications, 60 * 60 * 1000);

module.exports = {
    NOTIFICATION_TYPES,
    createNotification,
    notifyUsers,
    getUserNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    cleanupOldNotifications,
    registerSSEConnection,
    sendToUser,
    broadcast,
    broadcastToAdmins,
    getSSEStats
};

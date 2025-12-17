/**
 * Notification Routes
 * Real-time notifications with SSE support
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');

let db = null;
const sseConnections = new Map();

const setDb = (database) => { db = database; };

/**
 * GET /api/notifications
 * Get user notifications
 */
router.get('/', authenticate, (req, res) => {
    try {
        const { unread_only, limit = 50, offset = 0 } = req.query;

        let query = `SELECT * FROM notifications WHERE user_id = ?`;
        if (unread_only === 'true') {
            query += ` AND is_read = 0`;
        }
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

        const notifications = db.all(query, [req.user.id, parseInt(limit), parseInt(offset)]);
        const unreadCount = db.get(`
            SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
        `, [req.user.id]);

        res.json({
            success: true,
            data: notifications,
            unreadCount: unreadCount?.count || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
router.get('/unread-count', authenticate, (req, res) => {
    try {
        const result = db.get(`
            SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
        `, [req.user.id]);

        res.json({ success: true, count: result?.count || 0 });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark notification as read
 */
router.patch('/:id/read', authenticate, (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);

        db.run(`
            UPDATE notifications SET is_read = 1, read_at = datetime('now')
            WHERE id = ? AND user_id = ?
        `, [notificationId, req.user.id]);

        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read
 */
router.patch('/read-all', authenticate, (req, res) => {
    try {
        db.run(`
            UPDATE notifications SET is_read = 1, read_at = datetime('now')
            WHERE user_id = ? AND is_read = 0
        `, [req.user.id]);

        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete('/:id', authenticate, (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);

        db.run(`DELETE FROM notifications WHERE id = ? AND user_id = ?`,
            [notificationId, req.user.id]);

        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/notifications/stream
 * SSE endpoint for real-time notifications
 */
router.get('/stream', authenticate, (req, res) => {
    // Set up SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

    // Store connection
    if (!sseConnections.has(req.user.id)) {
        sseConnections.set(req.user.id, new Set());
    }
    sseConnections.get(req.user.id).add(res);

    // Heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
        res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 30000);

    // Handle disconnect
    req.on('close', () => {
        clearInterval(heartbeat);
        const connections = sseConnections.get(req.user.id);
        if (connections) {
            connections.delete(res);
            if (connections.size === 0) {
                sseConnections.delete(req.user.id);
            }
        }
    });
});

// Helper function to send notification to user
function sendNotificationToUser(userId, notification) {
    const connections = sseConnections.get(userId);
    if (connections) {
        const message = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
        for (const res of connections) {
            try {
                res.write(message);
            } catch (e) {
                connections.delete(res);
            }
        }
    }
}

// Create notification helper
function createNotification(userId, type, title, message, data = null) {
    const result = db.run(`
        INSERT INTO notifications (user_id, type, title, message, data, is_read)
        VALUES (?, ?, ?, ?, ?, 0)
    `, [userId, type, title, message, data ? JSON.stringify(data) : null]);

    const notification = {
        id: result.lastInsertRowid,
        user_id: userId,
        type, title, message, data,
        is_read: false,
        created_at: new Date().toISOString()
    };

    sendNotificationToUser(userId, notification);
    return notification;
}

module.exports = { router, setDb, createNotification, sendNotificationToUser };

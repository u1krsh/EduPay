/**
 * Admin Routes
 * User management, system settings, and administrative functions
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { authenticate, authorize } = require('../middleware/auth');
const config = require('../config');

let db = null;
const setDb = (database) => { db = database; };

/**
 * GET /api/admin/users
 * Get all users
 */
router.get('/users', authenticate, authorize('admin'), (req, res) => {
    try {
        const { role, limit = 50, offset = 0 } = req.query;

        let query = `
            SELECT id, email, name, role, department, phone, created_at
            FROM users WHERE 1=1
        `;
        const params = [];

        if (role) {
            query += ` AND role = ?`;
            params.push(role);
        }

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const users = db.all(query, params);
        const total = db.get(`SELECT COUNT(*) as count FROM users`);

        res.json({ success: true, data: users, total: total?.count || 0 });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/admin/users/:id
 * Get user details
 */
router.get('/users/:id', authenticate, authorize('admin'), (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        const user = db.get(`
            SELECT id, email, name, role, department, phone, created_at
            FROM users WHERE id = ?
        `, [userId]);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Get user's session stats
        const stats = db.get(`
            SELECT 
                COUNT(*) as total_sessions,
                SUM(calculated_amount) as total_earnings
            FROM sessions WHERE professor_id = ?
        `, [userId]);

        res.json({ success: true, data: { ...user, stats } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 */
router.post('/users', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { email, password, name, role, department, phone } = req.body;

        if (!email || !password || !name || !role) {
            return res.status(400).json({
                success: false,
                message: 'Email, password, name, and role are required'
            });
        }

        // Check if user exists
        const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existing) {
            return res.status(409).json({ success: false, message: 'Email already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(config.security.bcryptRounds);
        const hashedPassword = await bcrypt.hash(password, salt);

        const result = db.run(`
            INSERT INTO users (email, password, name, role, department, phone)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [email, hashedPassword, name, role, department, phone]);

        db.run(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'created_user', 'user', ?, 'Created user: ${name}')
        `, [req.user.id, result.lastInsertRowid]);

        res.status(201).json({
            success: true,
            message: 'User created',
            userId: result.lastInsertRowid
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/admin/users/:id
 * Update a user
 */
router.put('/users/:id', authenticate, authorize('admin'), (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { name, role, department, phone } = req.body;

        db.run(`
            UPDATE users SET 
                name = COALESCE(?, name),
                role = COALESCE(?, role),
                department = COALESCE(?, department),
                phone = COALESCE(?, phone)
            WHERE id = ?
        `, [name, role, department, phone, userId]);

        res.json({ success: true, message: 'User updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user
 */
router.delete('/users/:id', authenticate, authorize('admin'), (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        // Prevent self-deletion
        if (userId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete your own account'
            });
        }

        db.run('DELETE FROM users WHERE id = ?', [userId]);
        db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/admin/users/:id/reset-password
 * Reset user password
 */
router.post('/users/:id/reset-password', authenticate, authorize('admin'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { new_password } = req.body;

        if (!new_password || new_password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters'
            });
        }

        const salt = await bcrypt.genSalt(config.security.bcryptRounds);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/admin/disputes
 * Get all disputes
 */
router.get('/disputes', authenticate, authorize('admin'), (req, res) => {
    try {
        const { status } = req.query;

        let query = `
            SELECT d.*, 
                   s.date as session_date, s.topic, s.calculated_amount,
                   u.name as raised_by_name,
                   p.name as professor_name,
                   r.name as resolved_by_name
            FROM disputes d
            JOIN sessions s ON d.session_id = s.id
            JOIN users u ON d.raised_by = u.id
            JOIN users p ON s.professor_id = p.id
            LEFT JOIN users r ON d.resolved_by = r.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ` AND d.status = ?`;
            params.push(status);
        }

        query += ` ORDER BY d.created_at DESC`;

        const disputes = db.all(query, params);
        res.json({ success: true, data: disputes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PATCH /api/admin/disputes/:id/resolve
 * Resolve a dispute
 */
router.patch('/disputes/:id/resolve', authenticate, authorize('admin'), (req, res) => {
    try {
        const disputeId = parseInt(req.params.id);
        const { resolution, session_action } = req.body;

        db.run(`
            UPDATE disputes 
            SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now')
            WHERE id = ?
        `, [resolution, req.user.id, disputeId]);

        // Optionally update the related session
        if (session_action) {
            const dispute = db.get('SELECT session_id FROM disputes WHERE id = ?', [disputeId]);
            if (dispute && (session_action === 'approve' || session_action === 'reject')) {
                db.run(`
                    UPDATE sessions SET status = ? WHERE id = ?
                `, [session_action === 'approve' ? 'approved' : 'rejected', dispute.session_id]);
            }
        }

        res.json({ success: true, message: 'Dispute resolved' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/admin/system/stats
 * Get system statistics
 */
router.get('/system/stats', authenticate, authorize('admin'), (req, res) => {
    try {
        const users = db.get('SELECT COUNT(*) as count FROM users');
        const sessions = db.get('SELECT COUNT(*) as count FROM sessions');
        const payments = db.get('SELECT COUNT(*) as count FROM payments');
        const disputes = db.get('SELECT COUNT(*) as count FROM disputes');

        res.json({
            success: true,
            data: {
                users: users?.count || 0,
                sessions: sessions?.count || 0,
                payments: payments?.count || 0,
                disputes: disputes?.count || 0,
                dbSize: 'N/A',
                uptime: process.uptime()
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setDb };

/**
 * Payment Routes
 * Payment processing, invoicing, and financial operations
 */

const express = require('express');
const router = express.Router();

const { authenticate, authorize } = require('../middleware/auth');
const config = require('../config');

let db = null;
const setDb = (database) => { db = database; };

/**
 * GET /api/payments
 * Get all payments (admin only)
 */
router.get('/', authenticate, authorize('admin'), (req, res) => {
    try {
        const { status, professor_id, limit = 50, offset = 0 } = req.query;

        let query = `
            SELECT p.*, u.name as professor_name, u.department
            FROM payments p 
            JOIN users u ON p.professor_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ` AND p.status = ?`;
            params.push(status);
        }
        if (professor_id) {
            query += ` AND p.professor_id = ?`;
            params.push(parseInt(professor_id));
        }

        query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const payments = db.all(query, params);
        res.json({ success: true, data: payments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/payments/professor/:professorId
 * Get payments for a professor
 */
router.get('/professor/:professorId', authenticate, (req, res) => {
    try {
        const professorId = parseInt(req.params.professorId);

        if (req.user.role === 'professor' && req.user.id !== professorId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const payments = db.all(`
            SELECT * FROM payments WHERE professor_id = ? ORDER BY created_at DESC
        `, [professorId]);

        res.json({ success: true, data: payments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/payments/summary
 * Get payment summary by professor
 */
router.get('/summary', authenticate, authorize('admin'), (req, res) => {
    try {
        const summary = db.all(`
            SELECT 
                u.id as professor_id,
                u.name as professor_name,
                u.department,
                COUNT(CASE WHEN s.status = 'approved' THEN 1 END) as approved_sessions,
                SUM(CASE WHEN s.status = 'approved' THEN s.duration_hours ELSE 0 END) as total_hours,
                SUM(CASE WHEN s.status = 'approved' THEN s.calculated_amount ELSE 0 END) as total_amount,
                AVG(CASE WHEN s.status = 'approved' THEN s.rate_per_hour END) as avg_rate
            FROM users u
            LEFT JOIN sessions s ON u.id = s.professor_id
            WHERE u.role = 'professor'
            GROUP BY u.id
            ORDER BY total_amount DESC
        `);

        res.json({ success: true, data: summary });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/payments
 * Create a payment batch
 */
router.post('/', authenticate, authorize('admin'), (req, res) => {
    try {
        const { professor_id, period_start, period_end, scheduled_date } = req.body;

        if (!professor_id || !period_start || !period_end) {
            return res.status(400).json({
                success: false,
                message: 'Professor ID, period start and end required'
            });
        }

        // Get approved sessions for the period
        const sessions = db.all(`
            SELECT * FROM sessions 
            WHERE professor_id = ? AND status = 'approved'
            AND date BETWEEN ? AND ?
        `, [professor_id, period_start, period_end]);

        if (sessions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No approved sessions found for this period'
            });
        }

        const total_sessions = sessions.length;
        const total_hours = sessions.reduce((sum, s) => sum + s.duration_hours, 0);
        const total_amount = sessions.reduce((sum, s) => sum + s.calculated_amount, 0);

        const result = db.run(`
            INSERT INTO payments (
                professor_id, period_start, period_end, total_sessions, 
                total_hours, total_amount, status, scheduled_date, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `, [professor_id, period_start, period_end, total_sessions,
            total_hours, total_amount, scheduled_date, req.user.id]);

        db.run(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'created_payment', 'payment', ?, 'Payment batch created')
        `, [req.user.id, result.lastInsertRowid]);

        res.status(201).json({
            success: true,
            message: 'Payment batch created',
            paymentId: result.lastInsertRowid,
            summary: { total_sessions, total_hours, total_amount }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PATCH /api/payments/:id/schedule
 * Schedule a payment
 */
router.patch('/:id/schedule', authenticate, authorize('admin'), (req, res) => {
    try {
        const paymentId = parseInt(req.params.id);
        const { scheduled_date } = req.body;

        if (!scheduled_date) {
            return res.status(400).json({ success: false, message: 'Scheduled date required' });
        }

        db.run(`
            UPDATE payments SET status = 'scheduled', scheduled_date = ? WHERE id = ?
        `, [scheduled_date, paymentId]);

        db.run(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'scheduled_payment', 'payment', ?, 'Payment scheduled for ${scheduled_date}')
        `, [req.user.id, paymentId]);

        res.json({ success: true, message: 'Payment scheduled' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PATCH /api/payments/:id/process
 * Mark payment as processing
 */
router.patch('/:id/process', authenticate, authorize('admin'), (req, res) => {
    try {
        const paymentId = parseInt(req.params.id);

        db.run(`
            UPDATE payments SET status = 'processing' WHERE id = ?
        `, [paymentId]);

        res.json({ success: true, message: 'Payment is processing' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PATCH /api/payments/:id/complete
 * Mark payment as paid
 */
router.patch('/:id/complete', authenticate, authorize('admin'), (req, res) => {
    try {
        const paymentId = parseInt(req.params.id);
        const { transaction_ref } = req.body;

        // Generate transaction ref if not provided
        const txnRef = transaction_ref || `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        db.run(`
            UPDATE payments 
            SET status = 'paid', paid_date = date('now'), transaction_ref = ?
            WHERE id = ?
        `, [txnRef, paymentId]);

        db.run(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'processed_payment', 'payment', ?, 'Payment completed: ${txnRef}')
        `, [req.user.id, paymentId]);

        res.json({ success: true, message: 'Payment completed', transaction_ref: txnRef });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/payments/:id
 * Get payment details
 */
router.get('/:id', authenticate, (req, res) => {
    try {
        const paymentId = parseInt(req.params.id);

        const payment = db.get(`
            SELECT p.*, u.name as professor_name, u.email, u.department
            FROM payments p
            JOIN users u ON p.professor_id = u.id
            WHERE p.id = ?
        `, [paymentId]);

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        // Professors can only view their own payments
        if (req.user.role === 'professor' && payment.professor_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Get related sessions
        const sessions = db.all(`
            SELECT * FROM sessions 
            WHERE professor_id = ? AND status = 'approved'
            AND date BETWEEN ? AND ?
            ORDER BY date ASC
        `, [payment.professor_id, payment.period_start, payment.period_end]);

        res.json({
            success: true,
            data: { ...payment, sessions }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setDb };

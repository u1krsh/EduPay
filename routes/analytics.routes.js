/**
 * Analytics Routes
 * Dashboard statistics, reports, and trends
 */

const express = require('express');
const router = express.Router();

const { authenticate, authorize } = require('../middleware/auth');

let db = null;
const setDb = (database) => { db = database; };

/**
 * GET /api/analytics/admin
 * Get admin dashboard statistics
 */
router.get('/admin', authenticate, authorize('admin'), (req, res) => {
    try {
        const sessionStats = db.get(`
            SELECT 
                COUNT(*) as total_sessions,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_approval,
                SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) as disputed
            FROM sessions
        `);

        const paymentStats = db.get(`
            SELECT 
                SUM(CASE WHEN status = 'pending' THEN total_amount ELSE 0 END) as pending_payments,
                SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as paid_this_month
            FROM payments
        `);

        const professorCount = db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'professor'`);
        const openDisputes = db.get(`SELECT COUNT(*) as count FROM disputes WHERE status IN ('open', 'investigating')`);

        res.json({
            success: true,
            data: {
                ...sessionStats,
                ...paymentStats,
                professor_count: professorCount?.count || 0,
                open_disputes: openDisputes?.count || 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/analytics/professor/:id
 * Get professor dashboard statistics
 */
router.get('/professor/:id', authenticate, (req, res) => {
    try {
        const professorId = parseInt(req.params.id);

        if (req.user.role === 'professor' && req.user.id !== professorId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const stats = db.get(`
            SELECT 
                COUNT(*) as total_sessions,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_sessions,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_sessions,
                SUM(CASE WHEN status = 'approved' THEN duration_hours ELSE 0 END) as total_hours,
                SUM(CASE WHEN status = 'approved' THEN calculated_amount ELSE 0 END) as total_earnings
            FROM sessions WHERE professor_id = ?
        `, [professorId]);

        const pendingPayment = db.get(`
            SELECT SUM(calculated_amount) as pending_amount
            FROM sessions WHERE professor_id = ? AND status = 'approved'
        `, [professorId]);

        const lastPayment = db.get(`
            SELECT * FROM payments WHERE professor_id = ? AND status = 'paid'
            ORDER BY paid_date DESC LIMIT 1
        `, [professorId]);

        res.json({
            success: true,
            data: {
                ...stats,
                pending_payment: pendingPayment?.pending_amount || 0,
                last_payment: lastPayment
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/analytics/trends
 * Get trend analysis
 */
router.get('/trends', authenticate, authorize('admin'), (req, res) => {
    try {
        const { months = 6 } = req.query;

        const sessionsTrend = db.all(`
            SELECT 
                strftime('%Y-%m', date) as month,
                COUNT(*) as count,
                SUM(duration_hours) as hours,
                SUM(calculated_amount) as amount
            FROM sessions
            WHERE date >= date('now', '-${months} months') AND status = 'approved'
            GROUP BY strftime('%Y-%m', date)
            ORDER BY month ASC
        `);

        const paymentsTrend = db.all(`
            SELECT 
                strftime('%Y-%m', paid_date) as month,
                COUNT(*) as count,
                SUM(total_amount) as amount
            FROM payments
            WHERE paid_date >= date('now', '-${months} months') AND status = 'paid'
            GROUP BY strftime('%Y-%m', paid_date)
            ORDER BY month ASC
        `);

        const departmentStats = db.all(`
            SELECT 
                u.department,
                COUNT(s.id) as sessions,
                SUM(s.duration_hours) as hours,
                SUM(s.calculated_amount) as amount
            FROM sessions s
            JOIN users u ON s.professor_id = u.id
            WHERE s.status = 'approved'
            GROUP BY u.department
            ORDER BY amount DESC
        `);

        res.json({
            success: true,
            data: {
                sessions: sessionsTrend,
                payments: paymentsTrend,
                departments: departmentStats
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/analytics/performance
 * Get professor performance rankings
 */
router.get('/performance', authenticate, authorize('admin'), (req, res) => {
    try {
        const performance = db.all(`
            SELECT 
                u.id,
                u.name,
                u.department,
                COUNT(s.id) as total_sessions,
                SUM(CASE WHEN s.status = 'approved' THEN s.duration_hours ELSE 0 END) as total_hours,
                SUM(CASE WHEN s.status = 'approved' THEN s.calculated_amount ELSE 0 END) as total_earnings,
                AVG(CASE WHEN s.status = 'approved' THEN s.rate_per_hour END) as avg_rate,
                ROUND(100.0 * SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) / 
                    NULLIF(COUNT(s.id), 0), 2) as approval_rate
            FROM users u
            LEFT JOIN sessions s ON u.id = s.professor_id
            WHERE u.role = 'professor'
            GROUP BY u.id
            ORDER BY total_earnings DESC
        `);

        res.json({ success: true, data: performance });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/analytics/report
 * Generate financial report
 */
router.get('/report', authenticate, authorize('admin'), (req, res) => {
    try {
        const { start_date, end_date, group_by = 'month' } = req.query;

        let dateCondition = '';
        const params = [];
        if (start_date && end_date) {
            dateCondition = 'WHERE s.date BETWEEN ? AND ?';
            params.push(start_date, end_date);
        }

        const groupFormat = group_by === 'week' ? '%Y-%W' :
            group_by === 'day' ? '%Y-%m-%d' : '%Y-%m';

        const report = db.all(`
            SELECT 
                strftime('${groupFormat}', s.date) as period,
                COUNT(*) as total_sessions,
                COUNT(DISTINCT s.professor_id) as unique_professors,
                SUM(s.duration_hours) as total_hours,
                SUM(s.calculated_amount) as gross_amount,
                AVG(s.rate_per_hour) as avg_rate
            FROM sessions s
            ${dateCondition}
            GROUP BY strftime('${groupFormat}', s.date)
            ORDER BY period ASC
        `, params);

        res.json({
            success: true,
            data: report,
            filters: { start_date, end_date, group_by }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/analytics/activity
 * Get activity log
 */
router.get('/activity', authenticate, (req, res) => {
    try {
        const { limit = 50 } = req.query;

        let query = `
            SELECT a.*, u.name as user_name
            FROM activity_log a
            LEFT JOIN users u ON a.user_id = u.id
        `;

        // Professors only see their own activity
        if (req.user.role === 'professor') {
            query += ` WHERE a.user_id = ?`;
        }

        query += ` ORDER BY a.created_at DESC LIMIT ?`;

        const params = req.user.role === 'professor'
            ? [req.user.id, parseInt(limit)]
            : [parseInt(limit)];

        const activities = db.all(query, params);

        res.json({ success: true, data: activities });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setDb };

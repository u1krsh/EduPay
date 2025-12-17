/**
 * Analytics Service
 * Advanced analytics and reporting
 */

const config = require('../config');

// Note: These functions will use database module after it's updated

/**
 * Get dashboard statistics for admin
 */
function getAdminDashboardStats(db) {
    const sessionStats = db.get(`
        SELECT 
            COUNT(*) as total_sessions,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_approval,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_sessions,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_sessions
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

    return {
        sessions: sessionStats,
        payments: paymentStats,
        professorCount: professorCount?.count || 0,
        openDisputes: openDisputes?.count || 0
    };
}

/**
 * Get professor dashboard statistics
 */
function getProfessorDashboardStats(db, professorId) {
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

    return { ...stats, pending_payment: pendingPayment?.pending_amount || 0, last_payment: lastPayment };
}

/**
 * Get payment summary by professor
 */
function getPaymentSummaryByProfessor(db) {
    return db.all(`
        SELECT 
            u.id as professor_id, u.name as professor_name, u.department,
            COUNT(CASE WHEN s.status = 'approved' THEN 1 END) as approved_sessions,
            SUM(CASE WHEN s.status = 'approved' THEN s.duration_hours ELSE 0 END) as total_hours,
            SUM(CASE WHEN s.status = 'approved' THEN s.calculated_amount ELSE 0 END) as total_amount,
            AVG(CASE WHEN s.status = 'approved' THEN s.rate_per_hour END) as avg_rate
        FROM users u
        LEFT JOIN sessions s ON u.id = s.professor_id
        WHERE u.role = 'professor'
        GROUP BY u.id ORDER BY total_amount DESC
    `);
}

/**
 * Get trend analysis
 */
function getTrendAnalysis(db, months = 6) {
    const sessionsTrend = db.all(`
        SELECT strftime('%Y-%m', date) as month, COUNT(*) as count,
            SUM(duration_hours) as hours, SUM(calculated_amount) as amount
        FROM sessions
        WHERE date >= date('now', '-${months} months') AND status = 'approved'
        GROUP BY strftime('%Y-%m', date) ORDER BY month ASC
    `);

    const departmentStats = db.all(`
        SELECT u.department, COUNT(s.id) as sessions,
            SUM(s.calculated_amount) as amount, COUNT(DISTINCT s.professor_id) as professors
        FROM sessions s JOIN users u ON s.professor_id = u.id
        WHERE s.status = 'approved' GROUP BY u.department ORDER BY amount DESC
    `);

    return { sessions: sessionsTrend, departments: departmentStats };
}

module.exports = {
    getAdminDashboardStats,
    getProfessorDashboardStats,
    getPaymentSummaryByProfessor,
    getTrendAnalysis
};

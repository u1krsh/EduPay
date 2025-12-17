/**
 * Invoice Service
 * Invoice generation and management
 */

const config = require('../config');
const { stringUtils, currencyUtils, dateUtils } = require('../utils/helpers');

/**
 * Generate invoice number
 */
function generateInvoiceNumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${config.payment.invoicePrefix}-${year}${month}-${random}`;
}

/**
 * Calculate invoice totals
 */
function calculateInvoiceTotals(sessions) {
    const subtotal = sessions.reduce((sum, s) => sum + (s.calculated_amount || 0), 0);
    const taxRate = config.payment.taxRate;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    return {
        subtotal: currencyUtils.round(subtotal),
        taxRate,
        taxAmount: currencyUtils.round(tax),
        total: currencyUtils.round(total),
        totalHours: sessions.reduce((sum, s) => sum + (s.duration_hours || 0), 0),
        sessionCount: sessions.length
    };
}

/**
 * Generate invoice data
 */
function generateInvoiceData(db, professorId, periodStart, periodEnd) {
    // Get professor details
    const professor = db.get(`SELECT * FROM users WHERE id = ?`, [professorId]);
    if (!professor) return null;

    // Get approved sessions for period
    const sessions = db.all(`
        SELECT * FROM sessions 
        WHERE professor_id = ? AND status = 'approved'
        AND date BETWEEN ? AND ?
        ORDER BY date ASC
    `, [professorId, periodStart, periodEnd]);

    if (sessions.length === 0) return null;

    const totals = calculateInvoiceTotals(sessions);
    const invoiceNumber = generateInvoiceNumber();

    return {
        invoiceNumber,
        issueDate: dateUtils.toISODate(new Date()),
        dueDate: dateUtils.toISODate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
        professor: {
            id: professor.id,
            name: professor.name,
            email: professor.email,
            department: professor.department,
            phone: professor.phone
        },
        period: { start: periodStart, end: periodEnd },
        sessions: sessions.map(s => ({
            date: s.date,
            topic: s.topic,
            courseName: s.course_name,
            duration: s.duration_hours,
            rate: s.rate_per_hour,
            amount: s.calculated_amount
        })),
        totals,
        currency: config.payment.defaultCurrency,
        status: 'draft'
    };
}

/**
 * Create invoice in database
 */
function createInvoice(db, invoiceData) {
    const result = db.run(`
        INSERT INTO invoices (
            invoice_number, professor_id, period_start, period_end,
            subtotal, tax_rate, tax_amount, total,
            session_count, total_hours, status, issue_date, due_date, data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        invoiceData.invoiceNumber,
        invoiceData.professor.id,
        invoiceData.period.start,
        invoiceData.period.end,
        invoiceData.totals.subtotal,
        invoiceData.totals.taxRate,
        invoiceData.totals.taxAmount,
        invoiceData.totals.total,
        invoiceData.totals.sessionCount,
        invoiceData.totals.totalHours,
        'draft',
        invoiceData.issueDate,
        invoiceData.dueDate,
        JSON.stringify(invoiceData)
    ]);

    return { id: result.lastInsertRowid, ...invoiceData };
}

/**
 * Get invoices for professor
 */
function getProfessorInvoices(db, professorId) {
    return db.all(`
        SELECT * FROM invoices WHERE professor_id = ? ORDER BY issue_date DESC
    `, [professorId]);
}

/**
 * Get all invoices (admin)
 */
function getAllInvoices(db, options = {}) {
    const { status, limit = 50, offset = 0 } = options;
    let query = `
        SELECT i.*, u.name as professor_name, u.department
        FROM invoices i JOIN users u ON i.professor_id = u.id
    `;
    const params = [];

    if (status) {
        query += ` WHERE i.status = ?`;
        params.push(status);
    }

    query += ` ORDER BY i.issue_date DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return db.all(query, params);
}

module.exports = {
    generateInvoiceNumber,
    calculateInvoiceTotals,
    generateInvoiceData,
    createInvoice,
    getProfessorInvoices,
    getAllInvoices
};

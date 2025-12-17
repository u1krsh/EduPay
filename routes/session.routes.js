/**
 * Session Routes
 * CRUD operations for teaching sessions
 */

const express = require('express');
const router = express.Router();

const { authenticate, authorize, rateLimit } = require('../middleware/auth');
const { validate, validateQuery, validateParams, schemas } = require('../middleware/validator');

let db = null;
const setDb = (database) => { db = database; };

/**
 * GET /api/sessions
 * Get all sessions (admin only)
 */
router.get('/', authenticate, authorize('admin'), (req, res) => {
    try {
        const { status, date_from, date_to, professor_id, limit = 50, offset = 0 } = req.query;

        let query = `
            SELECT s.*, u.name as professor_name, u.department,
                   a.name as approved_by_name
            FROM sessions s 
            JOIN users u ON s.professor_id = u.id 
            LEFT JOIN users a ON s.approved_by = a.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ` AND s.status = ?`;
            params.push(status);
        }
        if (date_from) {
            query += ` AND s.date >= ?`;
            params.push(date_from);
        }
        if (date_to) {
            query += ` AND s.date <= ?`;
            params.push(date_to);
        }
        if (professor_id) {
            query += ` AND s.professor_id = ?`;
            params.push(parseInt(professor_id));
        }

        query += ` ORDER BY s.date DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const sessions = db.all(query, params);
        const total = db.get(`SELECT COUNT(*) as count FROM sessions`);

        res.json({ success: true, data: sessions, total: total?.count || 0 });
    } catch (error) {
        console.error('Get sessions error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sessions/professor/:professorId
 * Get sessions for a specific professor
 */
router.get('/professor/:professorId', authenticate, (req, res) => {
    try {
        const professorId = parseInt(req.params.professorId);

        // Professors can only view their own sessions
        if (req.user.role === 'professor' && req.user.id !== professorId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const sessions = db.all(`
            SELECT s.*, u.name as approved_by_name 
            FROM sessions s 
            LEFT JOIN users u ON s.approved_by = u.id 
            WHERE s.professor_id = ? 
            ORDER BY s.date DESC
        `, [professorId]);

        res.json({ success: true, data: sessions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sessions/pending
 * Get all pending sessions (admin only)
 */
router.get('/pending', authenticate, authorize('admin'), (req, res) => {
    try {
        const sessions = db.all(`
            SELECT s.*, u.name as professor_name, u.department 
            FROM sessions s 
            JOIN users u ON s.professor_id = u.id 
            WHERE s.status = 'pending' 
            ORDER BY s.date ASC
        `);
        res.json({ success: true, data: sessions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sessions
 * Create a new session
 */
router.post('/',
    authenticate,
    authorize('professor'),
    validate(schemas.createSession),
    (req, res) => {
        try {
            const { date, start_time, end_time, duration_hours, topic, course_name, rate_per_hour, notes } = req.body;
            const professorId = req.user.id;

            const calculated_amount = duration_hours * rate_per_hour;

            const result = db.run(`
                INSERT INTO sessions (professor_id, date, start_time, end_time, duration_hours, 
                    topic, course_name, rate_per_hour, calculated_amount, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            `, [professorId, date, start_time, end_time, duration_hours, topic,
                course_name, rate_per_hour, calculated_amount, notes]);

            // Log activity
            db.run(`
                INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, 'created_session', 'session', ?, 'New session created: ${topic}')
            `, [professorId, result.lastInsertRowid]);

            res.status(201).json({
                success: true,
                message: 'Session created successfully',
                sessionId: result.lastInsertRowid
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
);

/**
 * PUT /api/sessions/:id
 * Update a session
 */
router.put('/:id',
    authenticate,
    validate(schemas.updateSession),
    (req, res) => {
        try {
            const sessionId = parseInt(req.params.id);
            const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);

            if (!session) {
                return res.status(404).json({ success: false, message: 'Session not found' });
            }

            // Only owner can update, and only if pending
            if (req.user.role === 'professor') {
                if (session.professor_id !== req.user.id) {
                    return res.status(403).json({ success: false, message: 'Access denied' });
                }
                if (session.status !== 'pending') {
                    return res.status(400).json({ success: false, message: 'Can only edit pending sessions' });
                }
            }

            const { date, start_time, end_time, duration_hours, topic, course_name, rate_per_hour, notes } = req.body;

            const newDuration = duration_hours || session.duration_hours;
            const newRate = rate_per_hour || session.rate_per_hour;
            const calculated_amount = newDuration * newRate;

            db.run(`
                UPDATE sessions SET 
                    date = COALESCE(?, date),
                    start_time = COALESCE(?, start_time),
                    end_time = COALESCE(?, end_time),
                    duration_hours = COALESCE(?, duration_hours),
                    topic = COALESCE(?, topic),
                    course_name = COALESCE(?, course_name),
                    rate_per_hour = COALESCE(?, rate_per_hour),
                    calculated_amount = ?,
                    notes = COALESCE(?, notes)
                WHERE id = ?
            `, [date, start_time, end_time, duration_hours, topic, course_name,
                rate_per_hour, calculated_amount, notes, sessionId]);

            res.json({ success: true, message: 'Session updated' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
);

/**
 * PATCH /api/sessions/:id/approve
 * Approve a session (admin only)
 */
router.patch('/:id/approve', authenticate, authorize('admin'), (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        if (session.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Session is not pending' });
        }

        db.run(`
            UPDATE sessions 
            SET status = 'approved', approved_by = ?, approved_at = datetime('now')
            WHERE id = ?
        `, [req.user.id, sessionId]);

        // Log activity
        db.run(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'approved_session', 'session', ?, 'Session approved')
        `, [req.user.id, sessionId]);

        res.json({ success: true, message: 'Session approved' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PATCH /api/sessions/:id/reject
 * Reject a session (admin only)
 */
router.patch('/:id/reject', authenticate, authorize('admin'), (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { reason } = req.body;

        const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        db.run(`
            UPDATE sessions SET status = 'rejected', notes = ? WHERE id = ?
        `, [reason, sessionId]);

        db.run(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'rejected_session', 'session', ?, ?)
        `, [req.user.id, sessionId, reason || 'Session rejected']);

        res.json({ success: true, message: 'Session rejected' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sessions/bulk-approve
 * Approve multiple sessions (admin only)
 */
router.post('/bulk-approve', authenticate, authorize('admin'), (req, res) => {
    try {
        const { sessionIds } = req.body;

        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Session IDs required' });
        }

        const placeholders = sessionIds.map(() => '?').join(',');

        db.run(`
            UPDATE sessions 
            SET status = 'approved', approved_by = ?, approved_at = datetime('now')
            WHERE id IN (${placeholders}) AND status = 'pending'
        `, [req.user.id, ...sessionIds]);

        res.json({ success: true, message: `${sessionIds.length} sessions approved` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/sessions/:id
 * Delete a session
 */
router.delete('/:id', authenticate, (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const session = db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        // Only owner can delete pending sessions, admin can delete any
        if (req.user.role === 'professor') {
            if (session.professor_id !== req.user.id || session.status !== 'pending') {
                return res.status(403).json({ success: false, message: 'Cannot delete this session' });
            }
        }

        db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);

        res.json({ success: true, message: 'Session deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setDb };

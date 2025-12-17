/**
 * EduPay Platform - Main Server
 * Professor Payment Platform with Advanced Features
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// Import configuration
const config = require('./config');

// Import database
const { initDatabase, get, all, run } = require('./database');

// Import middleware
const { requestLogger, rateLimit } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth.routes');
const sessionRoutes = require('./routes/session.routes');
const paymentRoutes = require('./routes/payment.routes');
const notificationRoutes = require('./routes/notification.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const adminRoutes = require('./routes/admin.routes');

// Create Express app
const app = express();
const PORT = config.server.port;

// ============== MIDDLEWARE ==============

// CORS configuration
app.use(cors(config.cors));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (development)
if (config.server.env === 'development') {
    app.use(requestLogger);
}

// Global rate limiting
if (config.features.enableRateLimiting) {
    app.use('/api/', rateLimit(config.rateLimit.maxRequests, config.rateLimit.windowMs));
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// ============== DATABASE INJECTION ==============

// Create database wrapper for routes
const dbWrapper = { get, all, run };

// Inject database into route modules
authRoutes.setDb(dbWrapper);
sessionRoutes.setDb(dbWrapper);
paymentRoutes.setDb(dbWrapper);
notificationRoutes.setDb(dbWrapper);
analyticsRoutes.setDb(dbWrapper);
adminRoutes.setDb(dbWrapper);

// ============== ROUTES ==============

// NEW API Routes (JWT protected) - available at /api/v2 for future use
app.use('/api/v2/auth', authRoutes.router);
app.use('/api/v2/sessions', sessionRoutes.router);
app.use('/api/v2/payments', paymentRoutes.router);
app.use('/api/v2/notifications', notificationRoutes.router);
app.use('/api/v2/analytics', analyticsRoutes.router);
app.use('/api/v2/admin', adminRoutes.router);

// Legacy routes for backward compatibility with existing frontend
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    try {
        // Simple login for demo (frontend uses localStorage, not JWT yet)
        const user = get('SELECT id, email, name, role, department FROM users WHERE email = ?', [email]);

        if (user) {
            // For demo purposes, accept demo passwords
            const isDemo = (email.includes('sharma') || email.includes('kumar') || email.includes('patel')) && password === 'demo123';
            const isAdmin = (email.includes('admin') || email.includes('finance')) && password === 'admin123';

            if (isDemo || isAdmin) {
                run(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) 
                     VALUES (?, 'user_login', 'user', ?, 'User logged in')`, [user.id, user.id]);
                return res.json({ success: true, user });
            }
        }
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/auth/profile/:userId', (req, res) => {
    try {
        const user = get('SELECT id, email, name, role, department, phone, created_at FROM users WHERE id = ?',
            [parseInt(req.params.userId)]);
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Legacy session routes
app.get('/api/sessions/professor/:professorId', (req, res) => {
    try {
        const sessions = all(`
            SELECT s.*, u.name as approved_by_name 
            FROM sessions s 
            LEFT JOIN users u ON s.approved_by = u.id 
            WHERE s.professor_id = ? 
            ORDER BY s.date DESC
        `, [parseInt(req.params.professorId)]);
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/sessions/pending', (req, res) => {
    try {
        const sessions = all(`
            SELECT s.*, u.name as professor_name, u.department 
            FROM sessions s 
            JOIN users u ON s.professor_id = u.id 
            WHERE s.status = 'pending' 
            ORDER BY s.date ASC
        `);
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Create new session (professor)
app.post('/api/sessions', (req, res) => {
    try {
        const { professor_id, date, start_time, end_time, duration_hours, topic, course_name, rate_per_hour } = req.body;

        if (!professor_id || !date || !duration_hours || !topic || !rate_per_hour) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const calculated_amount = duration_hours * rate_per_hour;

        const result = run(`
            INSERT INTO sessions (professor_id, date, start_time, end_time, duration_hours, 
                topic, course_name, rate_per_hour, calculated_amount, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `, [professor_id, date, start_time, end_time, duration_hours, topic,
            course_name, rate_per_hour, calculated_amount]);

        run(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) 
             VALUES (?, 'created_session', 'session', ?, 'New session created: ${topic}')`,
            [professor_id, result.lastInsertRowid]);

        res.status(201).json({
            success: true,
            message: 'Session created successfully',
            sessionId: result.lastInsertRowid
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.patch('/api/sessions/:sessionId/approve', (req, res) => {
    const { adminId } = req.body;
    try {
        run(`UPDATE sessions SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`,
            [adminId, parseInt(req.params.sessionId)]);
        run(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'approved_session', 'session', ?, 'Session approved')`,
            [adminId, parseInt(req.params.sessionId)]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.patch('/api/sessions/:sessionId/reject', (req, res) => {
    const { adminId, reason } = req.body;
    try {
        run(`UPDATE sessions SET status = 'rejected', notes = ? WHERE id = ?`,
            [reason, parseInt(req.params.sessionId)]);
        run(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'rejected_session', 'session', ?, ?)`,
            [adminId, parseInt(req.params.sessionId), reason]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Legacy payment routes
app.get('/api/payments/professor/:professorId', (req, res) => {
    try {
        const payments = all(`SELECT * FROM payments WHERE professor_id = ? ORDER BY created_at DESC`,
            [parseInt(req.params.professorId)]);
        res.json(payments);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/payments/summary', (req, res) => {
    try {
        const summary = all(`
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
        res.json(summary);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Legacy stats routes
app.get('/api/stats/professor/:professorId', (req, res) => {
    try {
        const professorId = parseInt(req.params.professorId);
        const stats = get(`
            SELECT 
                COUNT(*) as total_sessions,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_sessions,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_sessions,
                SUM(CASE WHEN status = 'approved' THEN duration_hours ELSE 0 END) as total_hours,
                SUM(CASE WHEN status = 'approved' THEN calculated_amount ELSE 0 END) as total_earnings
            FROM sessions WHERE professor_id = ?
        `, [professorId]);

        const pendingPayment = get(`
            SELECT SUM(calculated_amount) as pending_amount
            FROM sessions WHERE professor_id = ? AND status = 'approved'
        `, [professorId]);

        const lastPayment = get(`
            SELECT * FROM payments WHERE professor_id = ? AND status = 'paid'
            ORDER BY paid_date DESC LIMIT 1
        `, [professorId]);

        res.json({
            ...stats,
            pending_payment: pendingPayment?.pending_amount || 0,
            last_payment: lastPayment
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/stats/admin', (req, res) => {
    try {
        const sessionStats = get(`
            SELECT 
                COUNT(*) as total_sessions,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_approval,
                SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) as disputed
            FROM sessions
        `);

        const paymentStats = get(`
            SELECT 
                SUM(CASE WHEN status = 'pending' THEN total_amount ELSE 0 END) as pending_payments,
                SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as paid_this_month
            FROM payments
        `);

        const professorCount = get(`SELECT COUNT(*) as count FROM users WHERE role = 'professor'`);
        const openDisputes = get(`SELECT COUNT(*) as count FROM disputes WHERE status IN ('open', 'investigating')`);

        res.json({
            ...sessionStats,
            ...paymentStats,
            professor_count: professorCount?.count || 0,
            open_disputes: openDisputes?.count || 0
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/activity', (req, res) => {
    try {
        const activities = all(`
            SELECT a.*, u.name as user_name
            FROM activity_log a
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC LIMIT 50
        `);
        res.json(activities);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Disputes
app.post('/api/disputes', (req, res) => {
    const { sessionId, raisedBy, reason, description } = req.body;
    try {
        const result = run(`INSERT INTO disputes (session_id, raised_by, reason, description) VALUES (?, ?, ?, ?)`,
            [sessionId, raisedBy, reason, description]);
        run(`UPDATE sessions SET status = 'disputed' WHERE id = ?`, [sessionId]);
        run(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'raised_dispute', 'dispute', ?, ?)`,
            [raisedBy, result.lastInsertRowid, reason]);
        res.json({ success: true, disputeId: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/disputes', (req, res) => {
    try {
        const disputes = all(`
            SELECT d.*, s.date as session_date, s.topic, s.calculated_amount,
                   u.name as raised_by_name, p.name as professor_name, r.name as resolved_by_name
            FROM disputes d
            JOIN sessions s ON d.session_id = s.id
            JOIN users u ON d.raised_by = u.id
            JOIN users p ON s.professor_id = p.id
            LEFT JOIN users r ON d.resolved_by = r.id
            ORDER BY d.created_at DESC
        `);
        res.json(disputes);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ============== HTML ROUTES ==============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/professor', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'professor.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============== ERROR HANDLING ==============

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    res.status(500).json({
        success: false,
        message: config.server.env === 'development' ? err.message : 'Internal server error'
    });
});

// ============== GRACEFUL SHUTDOWN ==============

function gracefulShutdown(signal) {
    console.log(`\n📴 Received ${signal}. Shutting down gracefully...`);
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============== START SERVER ==============

initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║   🎓 EduPay - Professor Payment Platform                          ║
║   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                              ║
║                                                                    ║
║   🌐 Server:      http://localhost:${PORT}                          ║
║   📡 Environment: ${config.server.env.padEnd(15)}                        ║
║                                                                    ║
║   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                              ║
║   Demo Credentials:                                                ║
║   👩‍🏫 Professor: dr.sharma@email.com / demo123                     ║
║   👨‍💼 Admin:     admin@institution.edu / admin123                  ║
║                                                                    ║
║   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                              ║
║   API Endpoints:                                                   ║
║   • /api/auth     - Authentication (JWT)                          ║
║   • /api/sessions - Session management                            ║
║   • /api/payments - Payment processing                            ║
║   • /api/analytics- Dashboard & reports                           ║
║   • /api/admin    - Administration                                ║
║   • /api/notifications - Real-time (SSE)                          ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
        `);
    });
}).catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
});

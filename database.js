const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

let db;
const DB_PATH = config.database.path;

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('✅ Created new database');
  }

  // Create tables
  createTables();

  // Seed demo data if empty
  const userCount = db.exec('SELECT COUNT(*) as count FROM users')[0];
  if (!userCount || userCount.values[0][0] === 0) {
    await seedData();
  }

  saveDatabase();
  console.log('✅ Database initialized');
}

function createTables() {
  // Users table
  db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT CHECK(role IN ('professor', 'admin')) NOT NULL,
            department TEXT,
            phone TEXT,
            avatar_url TEXT,
            is_active INTEGER DEFAULT 1,
            email_verified INTEGER DEFAULT 0,
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

  // Sessions table
  db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            professor_id INTEGER NOT NULL,
            date DATE NOT NULL,
            start_time TEXT,
            end_time TEXT,
            duration_hours REAL NOT NULL,
            topic TEXT NOT NULL,
            course_name TEXT,
            rate_per_hour REAL NOT NULL,
            calculated_amount REAL,
            status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'disputed')) DEFAULT 'pending',
            approved_by INTEGER,
            approved_at DATETIME,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (professor_id) REFERENCES users(id),
            FOREIGN KEY (approved_by) REFERENCES users(id)
        )
    `);

  // Payments table
  db.run(`
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            professor_id INTEGER NOT NULL,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            total_sessions INTEGER NOT NULL,
            total_hours REAL NOT NULL,
            total_amount REAL NOT NULL,
            tax_amount REAL DEFAULT 0,
            net_amount REAL,
            status TEXT CHECK(status IN ('pending', 'scheduled', 'processing', 'paid', 'failed')) DEFAULT 'pending',
            scheduled_date DATE,
            paid_date DATE,
            transaction_ref TEXT,
            payment_method TEXT,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (professor_id) REFERENCES users(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);

  // Disputes table
  db.run(`
        CREATE TABLE IF NOT EXISTS disputes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            raised_by INTEGER NOT NULL,
            reason TEXT NOT NULL,
            description TEXT,
            status TEXT CHECK(status IN ('open', 'investigating', 'resolved', 'closed')) DEFAULT 'open',
            priority TEXT CHECK(priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
            resolution TEXT,
            resolved_by INTEGER,
            resolved_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id),
            FOREIGN KEY (raised_by) REFERENCES users(id),
            FOREIGN KEY (resolved_by) REFERENCES users(id)
        )
    `);

  // Activity log table
  db.run(`
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id INTEGER,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

  // Notifications table
  db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            icon TEXT,
            color TEXT,
            data TEXT,
            priority TEXT DEFAULT 'normal',
            is_read INTEGER DEFAULT 0,
            read_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

  // Refresh tokens table
  db.run(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

  // Invoices table
  db.run(`
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT UNIQUE NOT NULL,
            professor_id INTEGER NOT NULL,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            subtotal REAL NOT NULL,
            tax_rate REAL,
            tax_amount REAL,
            total REAL NOT NULL,
            session_count INTEGER,
            total_hours REAL,
            status TEXT CHECK(status IN ('draft', 'sent', 'paid', 'cancelled')) DEFAULT 'draft',
            issue_date DATE,
            due_date DATE,
            paid_date DATE,
            data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (professor_id) REFERENCES users(id)
        )
    `);

  // User settings table
  db.run(`
        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            email_notifications INTEGER DEFAULT 1,
            sms_notifications INTEGER DEFAULT 0,
            theme TEXT DEFAULT 'light',
            language TEXT DEFAULT 'en',
            timezone TEXT DEFAULT 'Asia/Kolkata',
            settings_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

  // Bank accounts table
  db.run(`
        CREATE TABLE IF NOT EXISTS bank_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            account_holder_name TEXT NOT NULL,
            bank_name TEXT NOT NULL,
            account_number TEXT NOT NULL,
            ifsc_code TEXT NOT NULL,
            account_type TEXT DEFAULT 'savings',
            is_primary INTEGER DEFAULT 0,
            is_verified INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

  // Create indexes for better performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_professor ON sessions(professor_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_professor ON payments(professor_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`);
}

// Save database to file
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Seed demo data
async function seedData() {
  const salt = await bcrypt.genSalt(config.security.bcryptRounds);

  // Hash passwords
  const professorPassword = await bcrypt.hash('demo123', salt);
  const adminPassword = await bcrypt.hash('admin123', salt);

  // Insert demo users with hashed passwords
  db.run(`INSERT INTO users (email, password, name, role, department, phone) VALUES 
        ('dr.sharma@email.com', '${professorPassword}', 'Dr. Priya Sharma', 'professor', 'Computer Science', '+91 98765 43210'),
        ('prof.kumar@email.com', '${professorPassword}', 'Prof. Rajesh Kumar', 'professor', 'Mathematics', '+91 87654 32109'),
        ('dr.patel@email.com', '${professorPassword}', 'Dr. Anita Patel', 'professor', 'Physics', '+91 76543 21098'),
        ('admin@institution.edu', '${adminPassword}', 'Meera Krishnan', 'admin', 'Finance', '+91 99887 76655'),
        ('finance@institution.edu', '${adminPassword}', 'Suresh Nair', 'admin', 'Accounts', '+91 88776 65544')
    `);

  // Insert demo sessions
  const sessions = [
    [1, '2024-12-02', '09:00', '11:00', 2.0, 'Introduction to Machine Learning', 'CS501', 2500, 5000, 'approved', 4],
    [1, '2024-12-04', '14:00', '16:30', 2.5, 'Neural Networks Fundamentals', 'CS501', 2500, 6250, 'approved', 4],
    [1, '2024-12-06', '10:00', '12:00', 2.0, 'Deep Learning Applications', 'CS502', 2500, 5000, 'approved', 4],
    [1, '2024-12-09', '09:00', '11:30', 2.5, 'Convolutional Neural Networks', 'CS502', 2500, 6250, 'approved', 4],
    [1, '2024-12-11', '14:00', '16:00', 2.0, 'Natural Language Processing', 'CS503', 2500, 5000, 'pending', null],
    [1, '2024-12-13', '10:00', '13:00', 3.0, 'Transformer Architecture Workshop', 'CS503', 2500, 7500, 'pending', null],
    [2, '2024-12-03', '09:00', '11:00', 2.0, 'Linear Algebra Review', 'MATH201', 2000, 4000, 'approved', 4],
    [2, '2024-12-05', '11:00', '13:00', 2.0, 'Probability Theory', 'MATH202', 2000, 4000, 'approved', 4],
    [2, '2024-12-10', '09:00', '11:00', 2.0, 'Statistical Methods', 'MATH202', 2000, 4000, 'pending', null],
    [3, '2024-12-02', '14:00', '16:00', 2.0, 'Quantum Mechanics Basics', 'PHY301', 2200, 4400, 'approved', 5],
    [3, '2024-12-07', '10:00', '12:30', 2.5, 'Wave-Particle Duality', 'PHY301', 2200, 5500, 'approved', 5],
    [3, '2024-12-12', '14:00', '16:00', 2.0, 'Schrodinger Equation', 'PHY302', 2200, 4400, 'pending', null]
  ];

  sessions.forEach(s => {
    db.run(`INSERT INTO sessions (professor_id, date, start_time, end_time, duration_hours, topic, course_name, rate_per_hour, calculated_amount, status, approved_by) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, s);
  });

  // Insert a completed payment
  db.run(`INSERT INTO payments (professor_id, period_start, period_end, total_sessions, total_hours, total_amount, status, scheduled_date, paid_date, transaction_ref, created_by) 
            VALUES (1, '2024-11-01', '2024-11-30', 8, 18.5, 46250, 'paid', '2024-12-05', '2024-12-05', 'TXN-2024-1105-001', 4)`);

  // Insert activity log
  db.run(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES 
        (4, 'approved_session', 'session', 1, 'Approved session for Dr. Priya Sharma'),
        (4, 'approved_session', 'session', 2, 'Approved session for Dr. Priya Sharma'),
        (4, 'created_payment', 'payment', 1, 'Created payment batch for November 2024'),
        (4, 'processed_payment', 'payment', 1, 'Payment processed via bank transfer')
    `);

  console.log('✅ Demo data seeded successfully');
}

// Database query helpers
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  return { lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0].values[0][0] };
}

module.exports = { initDatabase, get, all, run };

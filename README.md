# EduPay 💰

> **Payment Transparency Platform for Freelance Professors**

EduPay is a comprehensive web platform designed to bring transparency and trust to payments for freelance and visiting professors working with educational institutions.

---

## ✨ Features

### For Professors 👩‍🏫
- **Session Management** - Log teaching sessions with course details, duration, and rates
- **Real-time Payment Status** - Track payment statuses (Pending, Approved, Scheduled, Paid)
- **Payment Breakdown** - Clear visualization of how payments are calculated
- **Calendar View** - Schedule overview with calendar integration
- **Downloadable Statements** - Export payment history and invoices

### For Administrators 👨‍💼
- **Session Approval Workflow** - Review and approve professor sessions
- **Auto-calculated Payouts** - Automatic payment calculation based on rates and hours
- **Monthly Summaries** - Financial reports for easy accounting
- **Dispute Resolution** - Built-in dispute management with activity history
- **Analytics Dashboard** - Platform-wide statistics and insights

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js, Express.js |
| **Database** | SQLite (sql.js) |
| **Authentication** | JWT (JSON Web Tokens) |
| **Password Hashing** | bcryptjs |
| **Frontend** | Vanilla HTML, CSS, JavaScript |

---

## 🚀 Getting Started

### Prerequisites
- Node.js v16.0.0 or higher
- npm (Node Package Manager)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd EduPay
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Access the application**
   
   Open your browser and navigate to: `http://localhost:3000`

### Development Mode

For hot-reload during development:
```bash
npm run dev
```

### Reset Database

To reset the database to its initial state:
```bash
npm run reset-db
```

---

## 🔐 Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| **Professor** | dr.sharma@email.com | demo123 |
| **Admin** | admin@institution.edu | admin123 |

---

## 📁 Project Structure

```
EduPay/
├── server.js           # Main Express server
├── config.js           # Centralized configuration
├── database.js         # SQLite database setup & operations
├── package.json        # Project dependencies
│
├── routes/             # API route handlers
│   ├── auth.routes.js        # Authentication endpoints
│   ├── session.routes.js     # Session management
│   ├── payment.routes.js     # Payment processing
│   ├── admin.routes.js       # Admin operations
│   ├── analytics.routes.js   # Analytics & reports
│   └── notification.routes.js # Notification system
│
├── middleware/         # Express middleware
│
├── services/           # Business logic services
│
├── utils/              # Utility functions
│
└── public/             # Frontend files
    ├── index.html      # Landing/Login page
    ├── professor.html  # Professor dashboard
    ├── admin.html      # Admin dashboard
    └── styles.css      # Global styles
```

---

## ⚙️ Configuration

Configuration is managed through `config.js` with environment variable support:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment mode | development |
| `JWT_SECRET` | JWT signing secret | (default dev key) |
| `DB_PATH` | Database file path | ./platform.db |

---

## 🔒 Security Features

- **JWT Authentication** - Secure token-based authentication
- **Password Hashing** - bcrypt with configurable rounds
- **Rate Limiting** - Protection against brute-force attacks
- **Security Headers** - X-Content-Type-Options, X-Frame-Options, X-XSS-Protection
- **Input Validation** - Request data validation
- **Graceful Shutdown** - Proper cleanup on server termination

---

## 💳 Payment Configuration

| Setting | Value |
|---------|-------|
| Currency | INR (₹) |
| Tax Rate | 18% GST |
| Payment Cycle | 30 days |
| Min Payout | ₹1,000 |

---

## 📜 License

This project is licensed under the **MIT License**.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

<div align="center">
  <strong>Built with ❤️ for Educators</strong>
</div>

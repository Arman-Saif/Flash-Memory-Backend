# ⚡ Number Flash — Backend API

A Node.js and Express serverless backend for **Number Flash**. It handles core backend logic, leaderboard scores, achievement processing, and user synchronization with **Supabase (PostgreSQL)**.

---

## 🛠️ Tech Stack

- **Runtime & Server**: Node.js, Express.js
- **Database & Auth**: Supabase (PostgreSQL)
- **Deployment**: Vercel Serverless Functions
- **Frontend Repository**: [Number Flash Frontend GitHub Repository](https://github.com/Arman-Saif/Flash-Memory-Codyza)

---

## ⚙️ Environment Configuration (`.env.example`)

Create a `.env` file in the root directory:

```env
PORT=5000
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
CLIENT_ORIGIN=https://memoryflash.vercel.app
```

---

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install

# Start development server locally
npm run dev

```

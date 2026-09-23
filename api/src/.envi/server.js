const express = require('express');
const cors = require('cors');
require('dotenv').config();

const setupDatabase = require('./config/setup');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const supervisorRoutes = require('./routes/supervisor');

const app = express();

// Middleware
app.use(cors({
  origin: 'http://localhost:5173', // Vite default port
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/supervisor', supervisorRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ message: '✅ OJT Backend is running!' });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log(`✅ OJT Server running at http://localhost:${PORT}`);
  await setupDatabase(); // Auto-create tables and seed data
});

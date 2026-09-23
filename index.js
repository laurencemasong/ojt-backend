import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import http from 'http';
import { Server } from 'socket.io';

const { Pool } = pg;

const app = express();
const server = http.createServer(app);

// ✅ Socket.io setup
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'OJT_DB',
  password: 'laurencemasong',
  port: 5432,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log(' Connected to PostgreSQL!');
    release();
  }
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  }
});

// ✅ Track online users
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', ({ userId, role }) => {
    if (!userId) return;
    onlineUsers[userId] = { socketId: socket.id, role };
    socket.userId = userId;
    socket.role = role;
    console.log(`${role} ${userId} joined`);
  });

  socket.on('sendMessage', async ({ senderId, senderRole, senderName, receiverId, receiverRole, receiverName, message }) => {
    try {
      const result = await pool.query(
        `INSERT INTO messages (sender_id, sender_role, sender_name, receiver_id, receiver_role, receiver_name, message)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [parseInt(senderId), senderRole, senderName, parseInt(receiverId), receiverRole, receiverName, message]
      );

      const savedMessage = result.rows[0];

      const receiverSocket = onlineUsers[receiverId];
      if (receiverSocket) {
        io.to(receiverSocket.socketId).emit('receiveMessage', savedMessage);
        io.to(receiverSocket.socketId).emit('newNotification', {
          from: senderName,
          message: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
          created_at: savedMessage.created_at
        });
      }

      socket.emit('receiveMessage', savedMessage);

    } catch (err) {
      console.error('Message error:', err);
    }
  });

  socket.on('markRead', async ({ senderId, receiverId }) => {
    try {
      await pool.query(
        'UPDATE messages SET is_read = true WHERE sender_id = $1 AND receiver_id = $2',
        [parseInt(senderId), parseInt(receiverId)]
      );
    } catch (err) {
      console.error('Mark read error:', err);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      delete onlineUsers[socket.userId];
    }
    console.log('User disconnected:', socket.id);
  });
});

// ───── STUDENTS ─────
app.post('/api/students/register', async (req, res) => {
  const { name, email, password, course, year_level, total_hours, supervisor_id, company_name, company_address, company_lat, company_lng } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO students (name, email, password, course, year_level, total_hours, supervisor_id, company_name, company_address, company_lat, company_lng) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, email, hashed, course || 'BSCS', year_level, total_hours || 162, supervisor_id || null, company_name || null, company_address || null, company_lat || null, company_lng || null]
    );
    res.json({ message: 'Student registered!', student: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM students WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    res.json({ message: 'Login successful!', student: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/supervisor/:supervisorId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM students WHERE supervisor_id = $1',
      [parseInt(req.params.supervisorId)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/course/:course', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM students WHERE UPPER(course) = UPPER($1) AND archived = false',
      [req.params.course]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/locations', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, course, year_level, company_name, company_address, 
       company_lat, company_lng, rendered_hours, total_hours, clearance_status, supervisor_id
       FROM students 
       WHERE company_lat IS NOT NULL AND company_lng IS NOT NULL AND archived = false`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/locations/course/:course', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, course, year_level, company_name, company_address,
       company_lat, company_lng, rendered_hours, total_hours, clearance_status, supervisor_id
       FROM students
       WHERE UPPER(course) = UPPER($1) AND company_lat IS NOT NULL 
       AND company_lng IS NOT NULL AND archived = false`,
      [req.params.course]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students WHERE id = $1', [parseInt(req.params.id)]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/archive', async (req, res) => {
  const { ids, archived } = req.body;
  try {
    await pool.query('UPDATE students SET archived = $1 WHERE id = ANY($2)', [archived, ids]);
    res.json({ message: 'Updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id/clearance', async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('UPDATE students SET clearance_status = $1 WHERE id = $2', [status, parseInt(req.params.id)]);
    res.json({ message: 'Clearance updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id/edit', async (req, res) => {
  const { name, email, course, year_level, total_hours, supervisor_id, company_name, company_address, company_lat, company_lng } = req.body;
  try {
    await pool.query(
      `UPDATE students SET name=$1, email=$2, course=$3, year_level=$4, total_hours=$5, 
       supervisor_id=$6, company_name=$7, company_address=$8, company_lat=$9, company_lng=$10 
       WHERE id=$11`,
      [name, email, course, year_level, total_hours, supervisor_id ? parseInt(supervisor_id) : null, company_name || null, company_address || null, company_lat || null, company_lng || null, parseInt(req.params.id)]
    );
    res.json({ message: 'Student updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id/password', async (req, res) => {
  const { password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('UPDATE students SET password = $1 WHERE id = $2', [hashed, parseInt(req.params.id)]);
    res.json({ message: 'Student password updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id/location', async (req, res) => {
  const { company_name, company_address, company_lat, company_lng } = req.body;
  try {
    await pool.query(
      'UPDATE students SET company_name=$1, company_address=$2, company_lat=$3, company_lng=$4 WHERE id=$5',
      [company_name, company_address, company_lat, company_lng, parseInt(req.params.id)]
    );
    res.json({ message: 'Location updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ message: 'Student deleted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── SUPERVISORS ─────
app.post('/api/supervisors/register', async (req, res) => {
  const { name, email, password, department } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO supervisors (name, email, password, department) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, email, hashed, department]
    );
    res.json({ message: 'Supervisor registered!', supervisor: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/supervisors/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM supervisors WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supervisor not found' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    res.json({ message: 'Login successful!', supervisor: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/supervisors/:id/edit', async (req, res) => {
  const { name, email, department } = req.body;
  try {
    await pool.query(
      'UPDATE supervisors SET name=$1, email=$2, department=$3 WHERE id=$4',
      [name, email, department, parseInt(req.params.id)]
    );
    res.json({ message: 'Supervisor updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/supervisors/:id/password', async (req, res) => {
  const { password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('UPDATE supervisors SET password = $1 WHERE id = $2', [hashed, parseInt(req.params.id)]);
    res.json({ message: 'Supervisor password updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/supervisors/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM supervisors WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ message: 'Supervisor deleted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── DEANS ─────
app.post('/api/deans/register', async (req, res) => {
  const { name, email, password, course } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO deans (name, email, password, course) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, email, hashed, course || null]
    );
    res.json({ message: 'Dean registered!', dean: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deans/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM deans WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Dean not found' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    res.json({ message: 'Login successful!', dean: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/deans/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM deans WHERE id = $1', [parseInt(req.params.id)]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/deans/:id/edit', async (req, res) => {
  const { name, email, course } = req.body;
  try {
    await pool.query(
      'UPDATE deans SET name=$1, email=$2, course=$3 WHERE id=$4',
      [name, email, course || null, parseInt(req.params.id)]
    );
    res.json({ message: 'Dean updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/deans/:id/password', async (req, res) => {
  const { password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('UPDATE deans SET password = $1 WHERE id = $2', [hashed, parseInt(req.params.id)]);
    res.json({ message: 'Dean password updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/deans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM deans WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ message: 'Dean deleted!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── SUPERADMIN ─────
app.post('/api/superadmin/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO superadmins (name, email, password) VALUES ($1,$2,$3) RETURNING *',
      [name, email, hashed]
    );
    res.json({ message: 'SuperAdmin registered!', superadmin: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/superadmin/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM superadmins WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'SuperAdmin not found' });
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    res.json({ message: 'Login successful!', superadmin: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/superadmin/users', async (req, res) => {
  try {
    const students = await pool.query('SELECT id, name, email, course, year_level, total_hours, rendered_hours, clearance_status, archived, supervisor_id FROM students ORDER BY course, name');
    const supervisors = await pool.query('SELECT id, name, email, department FROM supervisors ORDER BY name');
    const deans = await pool.query('SELECT id, name, email, course FROM deans ORDER BY name');
    const superadmins = await pool.query('SELECT id, name, email FROM superadmins ORDER BY name');
    res.json({ students: students.rows, supervisors: supervisors.rows, deans: deans.rows, superadmins: superadmins.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/superadmin/students', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students ORDER BY course, name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/superadmin/password', async (req, res) => {
  const { role, id, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const table = role === 'student' ? 'students' : role === 'supervisor' ? 'supervisors' : role === 'dean' ? 'deans' : 'superadmins';
    await pool.query(`UPDATE ${table} SET password = $1 WHERE id = $2`, [hashed, parseInt(id)]);
    res.json({ message: `✅ ${role} password updated successfully!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── USER MANAGEMENT ─────
app.get('/api/users', async (req, res) => {
  try {
    const students = await pool.query('SELECT id, name, email, course, year_level, total_hours, rendered_hours, clearance_status, archived, supervisor_id FROM students');
    const supervisors = await pool.query('SELECT id, name, email, department FROM supervisors');
    const deans = await pool.query('SELECT id, name, email, course FROM deans');
    res.json({ students: students.rows, supervisors: supervisors.rows, deans: deans.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── MESSAGES ─────
// ───── MESSAGES ─────

// Get conversation history between two users
app.get('/api/messages/:userId1/:userId2', async (req, res) => {
  try {
    const u1 = parseInt(req.params.userId1, 10);
    const u2 = parseInt(req.params.userId2, 10);

    if (isNaN(u1) || isNaN(u2)) {
      return res.status(400).json({ error: 'Invalid user IDs' });
    }

    const result = await pool.query(
      `SELECT * FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2) 
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC`,
      [u1, u2]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Unread messages count for a specific user
app.get('/api/messages/unread/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);

    if (isNaN(userId)) {
      return res.json({ count: 0 });
    }

    const result = await pool.query(
      'SELECT COUNT(*)::int AS count FROM messages WHERE receiver_id = $1 AND is_read = false',
      [userId]
    );

    res.json({ count: result.rows[0]?.count || 0 });
  } catch (err) {
    console.error('Unread messages query error:', err.message);
    res.json({ count: 0 });
  }
});

// Contacts list with latest message timestamp (Fixed with PostgreSQL CTE)
app.get('/api/messages/contacts/:userId/:role', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const query = `
      WITH conversation_list AS (
        SELECT 
          CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS contact_id,
          CASE WHEN sender_id = $1 THEN receiver_name ELSE sender_name END AS contact_name,
          CASE WHEN sender_id = $1 THEN receiver_role ELSE sender_role END AS contact_role,
          created_at
        FROM messages
        WHERE sender_id = $1 OR receiver_id = $1
      )
      SELECT 
        contact_id, 
        contact_name, 
        contact_role, 
        MAX(created_at) AS last_message_time
      FROM conversation_list
      GROUP BY contact_id, contact_name, contact_role
      ORDER BY last_message_time DESC
    `;

    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Contacts query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Mark unread messages as read
app.put('/api/messages/read/:senderId/:receiverId', async (req, res) => {
  try {
    const senderId = parseInt(req.params.senderId, 10);
    const receiverId = parseInt(req.params.receiverId, 10);

    if (isNaN(senderId) || isNaN(receiverId)) {
      return res.status(400).json({ error: 'Invalid user IDs' });
    }

    await pool.query(
      'UPDATE messages SET is_read = true WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false',
      [senderId, receiverId]
    );
    res.json({ message: 'Messages marked as read' });
  } catch (err) {
    console.error('Mark read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ───── TIME LOGS ─────

app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM time_logs ORDER BY date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch all logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/supervisor/:supervisorId', async (req, res) => {
  try {
    const supervisorId = parseInt(req.params.supervisorId, 10);

    if (isNaN(supervisorId)) {
      return res.status(400).json({ error: 'Invalid supervisor ID' });
    }

    const result = await pool.query(
      `SELECT tl.* FROM time_logs tl
       JOIN students s ON tl.student_id = s.id
       WHERE s.supervisor_id = $1
       ORDER BY tl.date DESC`,
      [supervisorId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Supervisor logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/:studentId', async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);

    if (isNaN(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID' });
    }

    const result = await pool.query(
      'SELECT * FROM time_logs WHERE student_id = $1 ORDER BY date DESC',
      [studentId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Student logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ───── TIME LOGS ─────
app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM time_logs ORDER BY date DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/supervisor/:supervisorId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT tl.* FROM time_logs tl
       JOIN students s ON tl.student_id = s.id
       WHERE s.supervisor_id = $1
       ORDER BY tl.date DESC`,
      [parseInt(req.params.supervisorId)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/:studentId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM time_logs WHERE student_id = $1 ORDER BY date DESC',
      [parseInt(req.params.studentId)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── SCAN ─────
app.post('/api/scan', async (req, res) => {
  const { student_id, supervisor_id } = req.body;
  try {
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [parseInt(student_id)]);
    if (student.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    if (student.rows[0].supervisor_id !== parseInt(supervisor_id)) {
      return res.status(403).json({ error: 'This student is not assigned to you!' });
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    await pool.query(
      `UPDATE time_logs SET time_out = time_in + interval '8 hours', hours = 8 
       WHERE student_id = $1 AND date < $2::date AND time_out IS NULL`,
      [parseInt(student_id), today]
    );

    const existing = await pool.query(
      'SELECT * FROM time_logs WHERE student_id = $1 AND date = $2::date',
      [parseInt(student_id), today]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO time_logs (student_id, name, date, time_in) 
         VALUES ($1, $2, $3::date, NOW() AT TIME ZONE 'Asia/Manila')`,
        [parseInt(student_id), student.rows[0].name, today]
      );
      return res.json({ message: ` ${student.rows[0].name} clocked IN!`, status: 'In' });

    } else if (!existing.rows[0].time_out) {
      const timeIn = new Date(existing.rows[0].time_in);
      const timeOut = new Date();
      const diffMinutes = (timeOut - timeIn) / 60000;

      if (isNaN(diffMinutes) || diffMinutes < 0.5) {
        return res.json({ message: ` Please wait at least 30 seconds before clocking out!`, status: 'Wait' });
      }

      const hours = Math.max(0.1, Math.round((diffMinutes / 60) * 10) / 10);

      await pool.query(
        `UPDATE time_logs SET time_out = NOW() AT TIME ZONE 'Asia/Manila', hours = $1 
         WHERE student_id = $2 AND date = $3::date`,
        [hours, parseInt(student_id), today]
      );
      await pool.query(
        'UPDATE students SET rendered_hours = COALESCE(rendered_hours, 0) + $1 WHERE id = $2',
        [hours, parseInt(student_id)]
      );
      return res.json({ message: ` ${student.rows[0].name} clocked OUT! (${hours} hrs)`, status: 'Out' });

    } else {
      return res.json({ message: ` Already clocked out today.`, status: 'Done' });
    }
  } catch (err) {
    console.error('Scan error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ───── EDIT LOG ─────
app.put('/api/logs/:id', async (req, res) => {
  const { time_in, time_out } = req.body;
  try {
    const [inH, inM] = time_in.split(':').map(Number);
    const [outH, outM] = time_out.split(':').map(Number);
    const hours = Math.round(((outH * 60 + outM) - (inH * 60 + inM)) / 60 * 10) / 10;

    await pool.query(
      'UPDATE time_logs SET time_in = $1, time_out = $2, hours = $3 WHERE id = $4',
      [time_in, time_out, hours, parseInt(req.params.id)]
    );

    const log = await pool.query('SELECT student_id FROM time_logs WHERE id = $1', [parseInt(req.params.id)]);
    if (log.rows.length > 0) {
      const studentId = log.rows[0].student_id;
      const allLogs = await pool.query('SELECT hours FROM time_logs WHERE student_id = $1', [studentId]);
      const totalHours = allLogs.rows.reduce((sum, l) => sum + Number(l.hours || 0), 0);
      await pool.query('UPDATE students SET rendered_hours = $1 WHERE id = $2', [totalHours, studentId]);
    }

    res.json({ message: 'Log updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── EVALUATIONS ─────
app.post('/api/evaluations', async (req, res) => {
  const {
    student_id, supervisor_id, student_name, supervisor_name,
    course, company_name, attendance, attitude, performance,
    communication, teamwork, initiative, overall_rating,
    final_grade, grade_descriptor, comments, recommendation, dean_email
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO evaluations 
       (student_id, supervisor_id, student_name, supervisor_name, course, company_name,
        attendance, attitude, performance, communication, teamwork, initiative,
        overall_rating, final_grade, grade_descriptor, comments, recommendation, dean_email, sent_to_dean)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true)`,
      [parseInt(student_id), parseInt(supervisor_id), student_name, supervisor_name, course, company_name,
       attendance, attitude, performance, communication, teamwork, initiative,
       overall_rating, final_grade, grade_descriptor, comments, recommendation, dean_email]
    );

    const mailOptions = {
      from: `"FVFC OJT Portal" <${process.env.GMAIL_USER}>`,
      to: dean_email,
      subject: 'FVFC OJT Portal - Student Performance Evaluation',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#1a237e,#0d47a1);padding:30px;text-align:center;">
            <h1 style="color:white;margin:0;"> FVFC OJT Portal</h1>
            <p style="color:#90caf9;margin:8px 0 0;">Student Performance Evaluation Report</p>
          </div>
          <div style="padding:24px;background:#f8f9fa;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px;color:#555;width:180px;"><b>Student:</b></td><td>${student_name}</td></tr>
              <tr style="background:#fff;"><td style="padding:8px;color:#555;"><b>Course:</b></td><td>${course}</td></tr>
              <tr><td style="padding:8px;color:#555;"><b>Company:</b></td><td>${company_name || 'N/A'}</td></tr>
              <tr style="background:#fff;"><td style="padding:8px;color:#555;"><b>Supervisor:</b></td><td>${supervisor_name}</td></tr>
              <tr><td style="padding:8px;color:#555;"><b>Date:</b></td><td>${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
            </table>
          </div>
          <div style="padding:24px;">
            <table style="width:100%;border-collapse:collapse;border:1px solid #ddd;">
              <thead><tr style="background:#1a237e;color:white;">
                <th style="padding:10px;text-align:left;">Category</th>
                <th style="padding:10px;text-align:center;">Weight</th>
                <th style="padding:10px;text-align:center;">Rating</th>
                <th style="padding:10px;text-align:center;">Weighted Score</th>
              </tr></thead>
              <tbody>
                ${[
                  ['Performance','25%',performance,((performance/5)*0.25*100).toFixed(2)],
                  ['Initiative','20%',initiative,((initiative/5)*0.20*100).toFixed(2)],
                  ['Communication','15%',communication,((communication/5)*0.15*100).toFixed(2)],
                  ['Teamwork','15%',teamwork,((teamwork/5)*0.15*100).toFixed(2)],
                  ['Attendance','15%',attendance,((attendance/5)*0.15*100).toFixed(2)],
                  ['Attitude','10%',attitude,((attitude/5)*0.10*100).toFixed(2)],
                ].map(([l,w,r,s],i)=>`
                  <tr style="background:${i%2===0?'#f8f9fa':'#fff'}">
                    <td style="padding:10px">${l}</td>
                    <td style="padding:10px;text-align:center;color:#1565c0;font-weight:bold">${w}</td>
                    <td style="padding:10px;text-align:center">${r}/5</td>
                    <td style="padding:10px;text-align:center;font-weight:bold">${s}%</td>
                  </tr>`).join('')}
              </tbody>
              <tfoot><tr style="background:#1a237e;color:white;">
                <td colspan="3" style="padding:12px;text-align:right;font-weight:bold">Total Weighted Score:</td>
                <td style="padding:12px;text-align:center;font-weight:bold;font-size:18px">${overall_rating}%</td>
              </tr></tfoot>
            </table>
          </div>
          <div style="padding:0 24px 24px;text-align:center;">
            <div style="background:#e3f2fd;border-radius:12px;padding:20px;border:2px solid #1565c0;">
              <p style="margin:0 0 8px;color:#555;">FINAL GRADE</p>
              <p style="margin:0;font-size:48px;font-weight:bold;color:#1565c0;">${final_grade}</p>
              <p style="margin:8px 0 0;font-size:18px;color:#555;">${grade_descriptor}</p>
              <p style="margin:4px 0 0;font-size:14px;color:#777;">Weighted Score: ${overall_rating}%</p>
            </div>
          </div>
          ${comments ? `<div style="padding:0 24px 24px;">
            <div style="background:#f8f9fa;padding:16px;border-radius:8px;border-left:4px solid #90caf9;">
              <p style="margin:0;color:#333;">${comments}</p>
            </div>
          </div>` : ''}
          <div style="background:#1a237e;padding:16px;text-align:center;">
            <p style="color:#90caf9;margin:0;font-size:12px;">FVFC OJT Portal • Felipe R. Verallo Foundation College • Bogo City, Cebu</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: ' Evaluation saved and sent to Dean successfully!' });

  } catch (err) {
    console.error('Evaluation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/evaluations', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM evaluations ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/evaluations/supervisor/:supervisorId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM evaluations WHERE supervisor_id = $1 ORDER BY created_at DESC',
      [parseInt(req.params.supervisorId)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/evaluations/course/:course', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM evaluations WHERE UPPER(course) = UPPER($1) ORDER BY created_at DESC',
      [req.params.course]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───── ANALYTICS ─────
app.get('/api/analytics/course/:course', async (req, res) => {
  try {
    const course = req.params.course;
    const students = await pool.query(
      `SELECT name, rendered_hours, total_hours, clearance_status FROM students WHERE UPPER(course) = UPPER($1) AND archived = false`,
      [course]
    );
    const clearance = await pool.query(
      `SELECT clearance_status, COUNT(*) as count FROM students WHERE UPPER(course) = UPPER($1) AND archived = false GROUP BY clearance_status`,
      [course]
    );
    const logs = await pool.query(
      `SELECT tl.date, SUM(tl.hours) as total_hours FROM time_logs tl
       JOIN students s ON tl.student_id = s.id
       WHERE UPPER(s.course) = UPPER($1) AND tl.date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY tl.date ORDER BY tl.date ASC`,
      [course]
    );
    const ratings = await pool.query(
      `SELECT AVG(attendance) as avg_attendance, AVG(attitude) as avg_attitude,
        AVG(performance) as avg_performance, AVG(communication) as avg_communication,
        AVG(teamwork) as avg_teamwork, AVG(initiative) as avg_initiative,
        AVG(overall_rating) as avg_overall
       FROM evaluations WHERE UPPER(course) = UPPER($1)`,
      [course]
    );
    const satisfaction = await pool.query(
      `SELECT recommendation, COUNT(*) as count FROM evaluations WHERE UPPER(course) = UPPER($1) GROUP BY recommendation`,
      [course]
    );
    res.json({ students: students.rows, clearance: clearance.rows, logs: logs.rows, ratings: ratings.rows[0], satisfaction: satisfaction.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: Completed cutoff route
app.get('/api/analytics/all', async (req, res) => {
  try {
    const students = await pool.query(`SELECT name, course, rendered_hours, total_hours, clearance_status FROM students WHERE archived = false`);
    const clearance = await pool.query(`SELECT clearance_status, COUNT(*) as count FROM students WHERE archived = false GROUP BY clearance_status`);
    res.json({ students: students.rows, clearance: clearance.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(` Server listening on port ${PORT}`);
});
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth');

// All routes require authentication
router.use(authMiddleware);

// GET /api/student/all - Get all active students
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM students WHERE is_archived = FALSE ORDER BY student_id'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/student/archived - Get archived students
router.get('/archived', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM students WHERE is_archived = TRUE ORDER BY student_id'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/student/:id - Get single student
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/student - Add new student (Dean only)
router.post('/', requireRole('dean'), async (req, res) => {
  const { student_id, full_name, course, company_name, total_hours } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO students (student_id, full_name, course, company_name, total_hours)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [student_id, full_name, course, company_name, total_hours || 600]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/student/archive-batch - Archive multiple students
router.put('/archive-batch', requireRole('dean'), async (req, res) => {
  const { ids } = req.body;
  try {
    await pool.query(
      'UPDATE students SET is_archived = TRUE WHERE student_id = ANY($1)',
      [ids]
    );
    res.json({ message: `Archived ${ids.length} students` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/student/:id/archive
router.put('/:id/archive', requireRole('dean'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE students SET is_archived = TRUE WHERE student_id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/student/:id/unarchive
router.put('/:id/unarchive', requireRole('dean'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE students SET is_archived = FALSE WHERE student_id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/student/:id/clearance - Update clearance status
router.put('/:id/clearance', requireRole('dean', 'supervisor'), async (req, res) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE students SET clearance_status = $1 WHERE student_id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/student/:id - Update student info
router.put('/:id', requireRole('dean'), async (req, res) => {
  const { full_name, course, company_name, total_hours } = req.body;
  try {
    const result = await pool.query(
      `UPDATE students SET full_name=$1, course=$2, company_name=$3, total_hours=$4
       WHERE student_id=$5 RETURNING *`,
      [full_name, course, company_name, total_hours, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

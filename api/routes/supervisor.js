import express from 'express';
import pool from '../config/db.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

// POST /api/supervisor/scan - QR Clock In or Out
router.post('/scan', requireRole('supervisor'), async (req, res) => {
  const { studentId } = req.body;

  try {
    // Find student
    const studentResult = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentResult.rows[0];
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().slice(0, 5); // HH:MM

    // Check for open log (clocked in but not out yet)
    const openLog = await pool.query(
      `SELECT * FROM time_logs
       WHERE student_id = $1 AND date = $2 AND time_out IS NULL`,
      [studentId, today]
    );

    if (openLog.rows.length === 0) {
      // CLOCK IN
      await pool.query(
        `INSERT INTO time_logs (student_id, student_name, date, time_in, supervisor_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [studentId, student.full_name, today, nowTime, req.user.id]
      );

      res.json({
        action: 'IN',
        studentName: student.full_name,
        timeIn: nowTime,
        message: `${student.full_name} clocked IN at ${nowTime}`,
      });

    } else {
      // CLOCK OUT
      const log = openLog.rows[0];
      const timeInParts = log.time_in.split(':');
      const nowParts = nowTime.split(':');
      const hoursWorked = (
        (parseInt(nowParts[0]) * 60 + parseInt(nowParts[1])) -
        (parseInt(timeInParts[0]) * 60 + parseInt(timeInParts[1]))
      ) / 60;
      const roundedHours = Math.round(hoursWorked * 10) / 10;

      await pool.query(
        `UPDATE time_logs SET time_out = $1, hours_rendered = $2
         WHERE id = $3`,
        [nowTime, roundedHours, log.id]
      );

      // Update student total hours
      await pool.query(
        `UPDATE students SET hours_rendered = hours_rendered + $1
         WHERE student_id = $2`,
        [roundedHours, studentId]
      );

      res.json({
        action: 'OUT',
        studentName: student.full_name,
        timeOut: nowTime,
        hours: roundedHours,
        message: `${student.full_name} clocked OUT at ${nowTime} (${roundedHours} hrs)`,
      });
    }

  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supervisor/logs - Get all time logs
router.get('/logs', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM time_logs ORDER BY date DESC, time_in DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supervisor/logs/:studentId - Logs for a specific student
router.get('/logs/:studentId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM time_logs WHERE student_id = $1 ORDER BY date DESC',
      [req.params.studentId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/supervisor/logs/:id - Edit a time log (overtime adjustment)
router.put('/logs/:id', requireRole('supervisor', 'dean'), async (req, res) => {
  const { timeIn, timeOut, overtime } = req.body;

  try {
    // Get old log to adjust student hours
    const oldLog = await pool.query('SELECT * FROM time_logs WHERE id = $1', [req.params.id]);
    if (oldLog.rows.length === 0) return res.status(404).json({ error: 'Log not found' });

    const old = oldLog.rows[0];
    const oldHours = parseFloat(old.hours_rendered) || 0;

    // Calculate new hours
    const inParts = timeIn.split(':');
    const outParts = timeOut.split(':');
    const newHours = Math.round(
      ((parseInt(outParts[0]) * 60 + parseInt(outParts[1])) -
       (parseInt(inParts[0]) * 60 + parseInt(inParts[1]))) / 60 * 10
    ) / 10;

    // Update log
    const result = await pool.query(
      `UPDATE time_logs SET time_in=$1, time_out=$2, hours_rendered=$3, is_overtime=$4
       WHERE id=$5 RETURNING *`,
      [timeIn, timeOut, newHours, overtime || false, req.params.id]
    );

    // Adjust student hours
    await pool.query(
      `UPDATE students SET hours_rendered = GREATEST(0, hours_rendered - $1 + $2)
       WHERE student_id = $3`,
      [oldHours, newHours, old.student_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
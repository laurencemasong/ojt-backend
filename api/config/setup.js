const pool = require('./db');
const bcrypt = require('bcryptjs');

const setupDatabase = async () => {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('dean', 'student', 'supervisor')),
        full_name VARCHAR(100),
        email VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create students table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        student_id VARCHAR(20) PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        course VARCHAR(50),
        company_name VARCHAR(100),
        hours_rendered INT DEFAULT 0,
        total_hours INT DEFAULT 600,
        clearance_status VARCHAR(20) DEFAULT 'Pending' CHECK (clearance_status IN ('Pending', 'Approved', 'Denied')),
        is_archived BOOLEAN DEFAULT FALSE,
        user_id INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create time_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS time_logs (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(20) REFERENCES students(student_id),
        student_name VARCHAR(100),
        date DATE NOT NULL,
        time_in TIME,
        time_out TIME,
        hours_rendered DECIMAL(4,1) DEFAULT 0,
        is_overtime BOOLEAN DEFAULT FALSE,
        supervisor_id INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Tables created successfully');

    // Seed default accounts
    const existingUsers = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(existingUsers.rows[0].count) === 0) {
      const hashedDean = await bcrypt.hash('edselmonsalod', 10);
      const hashedSupervisor = await bcrypt.hash('BossEdsel', 10);
      const hashedStudent = await bcrypt.hash('CSstudent', 10);

      await pool.query(`
        INSERT INTO users (username, password, role, full_name) VALUES
        ('dean', $1, 'dean', 'Dean Edsel Monsalod'),
        ('supervisor', $2, 'supervisor', 'Supervisor'),
        ('student1', $3, 'student', 'Aleson JR III')
      `, [hashedDean, hashedSupervisor, hashedStudent]);

      console.log('✅ Default users seeded');
    }

    // Seed sample students
    const existingStudents = await pool.query('SELECT COUNT(*) FROM students');
    if (parseInt(existingStudents.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO students (student_id, full_name, course, company_name, hours_rendered, total_hours, clearance_status) VALUES
        ('2023-001', 'Aleson JR III', 'BSIT', 'TechCorp Inc.', 150, 600, 'Pending'),
        ('2023-002', 'Anthony SR', 'BSCS', 'DevHub Corp.', 450, 600, 'Approved'),
        ('2023-003', 'Luige II', 'BSIT', 'SoftWave Solutions', 600, 600, 'Approved')
      `);

      console.log('✅ Sample students seeded');
    }

  } catch (err) {
    console.error('❌ Database setup error:', err.message);
  }
};

module.exports = setupDatabase;

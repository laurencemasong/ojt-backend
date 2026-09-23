const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'yourpassword',
  database: 'your_db_name',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Use the pool to execute a query
pool.query('SELECT * FROM users', (err, results) => {
  console.log(results);
});

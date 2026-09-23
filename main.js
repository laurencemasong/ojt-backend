import pg from 'pg';
const { Client } = pg;
const client = new Client({
    user: 'postgres',
    host: 'localhost',
    port: 5432,
    password: 'laurencemasong',
    database: 'OJT_DB'
});

client.connect().then(() => console.log("connected"));
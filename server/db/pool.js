import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Tell pg how to parse dates — return them as strings not JS Date objects
// This prevents timezone conversion issues
pg.types.setTypeParser(1082, (val) => val); // date type
pg.types.setTypeParser(1114, (val) => val); // timestamp type
pg.types.setTypeParser(1184, (val) => val); // timestamptz type

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  options: '-c timezone=Asia/Jerusalem'
});

export default pool;

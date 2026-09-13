import mysql from 'mysql2/promise';

import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.database,
  connectionLimit: 10,
  timezone: 'Z',
});

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db/pool.js';
import shopRoutes from './routes/shops.js';
import barberRoutes from './routes/barbers.js';
import serviceRoutes from './routes/services.js';
import scheduleRoutes from './routes/schedules.js';
import appointmentRoutes from './routes/appointments.js';
import authRoutes from './routes/auth.js';

dotenv.config();

const app = express();
const PORT= process.env.PORT || 5000;

//Middleware
app.use( cors() );
app.use( express.json() );

//Test route
app.get('/', (req,res) => {
    res.json( {message: 'Barbershop API is running ✅'} );
})



//Test database connection route
app.get('/db-test', async (req, res) => {
    try{
        const result = await pool.query('SELECT NOW()');
        res.json({
            message: 'Database connected ✅',
            time: result.rows[0].now
        });
    } catch (error) {
        res.status(500).json({ message: 'Database connection failed ❌',
                               error: error.message
        });
    }
});

// Routes
app.use('/api/shops', shopRoutes);
app.use('/api/barbers', barberRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/auth', authRoutes);

//Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

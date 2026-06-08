import pool from '../db/pool.js';

// ----------------------------
// HELPER: verify barber belongs to shop
// ----------------------------
const verifyBarberOwnership = async (barberId, shopId) => {
  const result = await pool.query(
    'SELECT id FROM barbers WHERE id = $1 AND shop_id = $2',
    [barberId, shopId]
  );
  return result.rows.length > 0;
};

// ----------------------------
// POST /api/schedules/barber/:barberId
// Shop admin or barber can set schedule
// Barber can only set their own schedule
// Shop admin can only set schedules for barbers in their shop
// ----------------------------
export const setBarberSchedule = async (req, res) => {
  const { barberId } = req.params;
  const { shop_id, schedule } = req.body;

  if (!shop_id || !schedule || !Array.isArray(schedule)) {
    return res.status(400).json({ message: 'shop_id and schedule array are required' });
  }

  if (schedule.length !== 7) {
    return res.status(400).json({ message: 'schedule must contain exactly 7 days (0=Sunday to 6=Saturday)' });
  }

  // Ownership check
  if (req.user.role === 'barber') {
    // Barber can only set their own schedule
    if (req.user.id !== parseInt(barberId)) {
      return res.status(403).json({ message: 'Access denied' });
    }
  } else if (req.user.role === 'shop_admin') {
    // Shop admin can only set schedules for barbers in their own shop
    if (req.user.shop_id !== parseInt(shop_id)) {
      return res.status(403).json({ message: 'Access denied' });
    }
  }

  try {
    const isOwned = await verifyBarberOwnership(barberId, shop_id);
    if (!isOwned) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    for (const day of schedule) {
      if (day.day_of_week === undefined || day.day_of_week < 0 || day.day_of_week > 6) {
        return res.status(400).json({ message: 'Each day must have a day_of_week between 0 and 6' });
      }
      if (!day.is_day_off && (!day.start_time || !day.end_time)) {
        return res.status(400).json({ message: `Day ${day.day_of_week} is missing start_time or end_time` });
      }
      if (!day.is_day_off && day.start_time >= day.end_time) {
        return res.status(400).json({ message: `Day ${day.day_of_week} start_time must be before end_time` });
      }
    }

    await pool.query('DELETE FROM barber_schedules WHERE barber_id = $1', [barberId]);

    const insertedDays = [];
    for (const day of schedule) {
      const result = await pool.query(
        `INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time, is_day_off)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          barberId,
          day.day_of_week,
          day.is_day_off ? null : day.start_time,
          day.is_day_off ? null : day.end_time,
          day.is_day_off ?? false
        ]
      );
      insertedDays.push(result.rows[0]);
    }

    res.status(201).json({ message: 'Schedule set ✅', schedule: insertedDays });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/schedules/barber/:barberId
// ----------------------------
export const getBarberSchedule = async (req, res) => {
  const { barberId } = req.params;
  const { shop_id } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  // Ownership check
  if (req.user.role === 'barber' && req.user.id !== parseInt(barberId)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  if (req.user.role === 'shop_admin' && req.user.shop_id !== parseInt(shop_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const isOwned = await verifyBarberOwnership(barberId, shop_id);
    if (!isOwned) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    const result = await pool.query(
      `SELECT * FROM barber_schedules
       WHERE barber_id = $1
       ORDER BY day_of_week ASC`,
      [barberId]
    );

    res.json({ schedule: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// POST /api/schedules/exceptions
// ----------------------------
export const setScheduleException = async (req, res) => {
  const { shop_id, barber_id, exception_date, is_day_off, start_time, end_time, reason } = req.body;

  if (!shop_id || !barber_id || !exception_date) {
    return res.status(400).json({ message: 'shop_id, barber_id and exception_date are required' });
  }

  if (!is_day_off && (!start_time || !end_time)) {
    return res.status(400).json({ message: 'start_time and end_time are required when is_day_off is false' });
  }

  if (!is_day_off && start_time >= end_time) {
    return res.status(400).json({ message: 'start_time must be before end_time' });
  }

  // Ownership check
  if (req.user.role === 'barber' && req.user.id !== parseInt(barber_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  if (req.user.role === 'shop_admin' && req.user.shop_id !== parseInt(shop_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(exception_date) < today) {
    return res.status(400).json({ message: 'exception_date cannot be in the past' });
  }

  try {
    const isOwned = await verifyBarberOwnership(barber_id, shop_id);
    if (!isOwned) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    const result = await pool.query(
      `INSERT INTO barber_schedule_exceptions
        (barber_id, exception_date, is_day_off, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (barber_id, exception_date)
       DO UPDATE SET
         is_day_off = EXCLUDED.is_day_off,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         reason = EXCLUDED.reason
       RETURNING *`,
      [barber_id, exception_date, is_day_off ?? true, start_time || null, end_time || null, reason || null]
    );

    res.status(201).json({ message: 'Exception set ✅', exception: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/schedules/exceptions/barber/:barberId
// ----------------------------
export const getBarberExceptions = async (req, res) => {
  const { barberId } = req.params;
  const { shop_id } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  // Ownership check
  if (req.user.role === 'barber' && req.user.id !== parseInt(barberId)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  if (req.user.role === 'shop_admin' && req.user.shop_id !== parseInt(shop_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const isOwned = await verifyBarberOwnership(barberId, shop_id);
    if (!isOwned) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    const result = await pool.query(
      `SELECT * FROM barber_schedule_exceptions
       WHERE barber_id = $1
         AND exception_date >= CURRENT_DATE
       ORDER BY exception_date ASC`,
      [barberId]
    );

    res.json({ exceptions: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// DELETE /api/schedules/exceptions/:id
// ----------------------------
export const deleteScheduleException = async (req, res) => {
  const { id } = req.params;
  const { shop_id, barber_id } = req.query;

  if (!shop_id || !barber_id) {
    return res.status(400).json({ message: 'shop_id and barber_id query parameters are required' });
  }

  // Ownership check
  if (req.user.role === 'barber' && req.user.id !== parseInt(barber_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  if (req.user.role === 'shop_admin' && req.user.shop_id !== parseInt(shop_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const isOwned = await verifyBarberOwnership(barber_id, shop_id);
    if (!isOwned) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    const result = await pool.query(
      'DELETE FROM barber_schedule_exceptions WHERE id = $1 AND barber_id = $2 RETURNING id',
      [id, barber_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Exception not found for this barber' });
    }

    res.json({ message: 'Exception deleted ✅' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

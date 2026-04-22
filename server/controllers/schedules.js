import pool from '../db/pool.js';

// helper to check if a barber belongs to a shop
const verifyBarberOwnership = async (barberId, shopId) => {
  const result = await pool.query(
    'SELECT id FROM barbers WHERE id = $1 AND shop_id = $2',
    [barberId, shopId]
  );
  return result.rows.length > 0;
};

// ----------------------------
// POST /api/schedules/barber/:barberId
// Set weekly schedule for a barber
// Expects an array of 7 days covering the full week
// ----------------------------
export const setBarberSchedule = async (req, res) => {
  const { barberId } = req.params;
  const { shop_id, schedule } = req.body;

  // schedule should be an array of 7 days like:
  // [
  //   { day_of_week: 0, is_day_off: true },
  //   { day_of_week: 1, is_day_off: false, start_time: '09:00', end_time: '17:00' },
  //   ...
  // ]

  if (!shop_id || !schedule || !Array.isArray(schedule)) {
    return res.status(400).json({ message: 'shop_id and schedule array are required' });
  }

  if (schedule.length !== 7) {
    return res.status(400).json({ message: 'schedule must contain exactly 7 days (0=Sunday to 6=Saturday)' });
  }

  try {
    // Check barber belongs to this shop
    const isOwned = await verifyBarberOwnership(barberId, shop_id);
    if (!isOwned) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    // Validate each day entry
    for (const day of schedule) {
      if (day.day_of_week === undefined || day.day_of_week < 0 || day.day_of_week > 6) {
        return res.status(400).json({ message: 'Each day must have a day_of_week between 0 and 6' });
      }
      if (!day.is_day_off && (!day.start_time || !day.end_time)) {
        return res.status(400).json({ message: `Day ${day.day_of_week} is not a day off but is missing start_time or end_time` });
      }
      if (!day.is_day_off && day.start_time >= day.end_time) {
        return res.status(400).json({ message: `Day ${day.day_of_week} start_time must be before end_time` });
      }
    }

    // Delete existing schedule for this barber then re-insert
    // This is simpler and cleaner than trying to update each day individually
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
// Get weekly schedule for a barber
// ----------------------------
export const getBarberSchedule = async (req, res) => {
  const { barberId } = req.params;
  const { shop_id } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  try {
    // Check barber exists AND belongs to this shop
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
// Add a schedule exception (day off or special hours for a specific date)
// ----------------------------
export const setScheduleException = async (req, res) => {
  const { shop_id, barber_id, exception_date, is_day_off, start_time, end_time, reason } = req.body;

  if (!shop_id || !barber_id || !exception_date) {
    return res.status(400).json({ message: 'shop_id, barber_id and exception_date are required' });
  }

  // if it's not a day off, times are required
  if (!is_day_off && (!start_time || !end_time)) {
    return res.status(400).json({ message: 'start_time and end_time are required when is_day_off is false' });
  }

  if (!is_day_off && start_time >= end_time) {
    return res.status(400).json({ message: 'start_time must be before end_time' });
  }

  // exception_date cannot be in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(exception_date) < today) {
    return res.status(400).json({ message: 'exception_date cannot be in the past' });
  }

  try {
    // Check barber belongs to this shop
    const isOwned = await verifyBarberOwnership(barber_id, shop_id);
    if (!isOwned) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    // Use INSERT ... ON CONFLICT to update if exception already exists for this date
    // This way calling it twice for the same date just updates instead of erroring
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
// Get all future exceptions for a barber
// ----------------------------
export const getBarberExceptions = async (req, res) => {
  const { barberId } = req.params;
  const { shop_id } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  try {
    // Check barber exists AND belongs to this shop
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
// Delete a schedule exception
// ----------------------------
export const deleteScheduleException = async (req, res) => {
  const { id } = req.params;
  const { shop_id, barber_id } = req.query;

  if (!shop_id || !barber_id) {
    return res.status(400).json({ message: 'shop_id and barber_id query parameters are required' });
  }

  try {
    // Check barber belongs to this shop
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
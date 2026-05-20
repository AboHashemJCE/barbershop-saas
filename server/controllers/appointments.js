/*
    ToDo:
    - Continue going through the code to fully undersetand it
    - Add comments to explain complex logic, especially the SQL queries
    - Check latest claude edits to implemnt important changes to the code
*/



import pool from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

// ----------------------------
// HELPER: Convert 'HH:MM' or 'HH:MM:SS' to minutes from midnight
// ----------------------------
const toMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// ----------------------------
// HELPER: Convert minutes from midnight to 'HH:MM'
// ----------------------------
const toTimeString = (totalMinutes) => {
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const mins = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
};

const hasValue = (val) => val !== undefined && val !== null;



// ----------------------------
// GET /api/appointments/availability
// Query params: 
//   shop_id, date, total_duration, customer_type
//   already_chosen (JSON string): [{ barber_id, start_time, end_time }]
// ----------------------------
export const getAvailability = async (req, res) => {
  const { shop_id, total_duration, customer_type = 'adult' } = req.query;

  let already_chosen = [];
  if (req.query.already_chosen) {
    try {
      already_chosen = JSON.parse(req.query.already_chosen);
    } catch {
      return res.status(400).json({ message: 'already_chosen must be a valid JSON array' });
    }
  }

  if (!shop_id || !total_duration) {
    return res.status(400).json({ message: 'shop_id and total_duration are required' });
  }

  if (!['adult', 'child'].includes(customer_type)) {
    return res.status(400).json({ message: 'customer_type must be adult or child' });
  }

  const totalDurationMinutes = parseInt(total_duration);
  if (isNaN(totalDurationMinutes) || totalDurationMinutes <= 0) {
    return res.status(400).json({ message: 'total_duration must be a positive number' });
  }

  for (const [index, person] of already_chosen.entries()) {
    if (!person.barber_id || !person.date || !person.start_time || !person.end_time) {
      return res.status(400).json({
        message: `already_chosen[${index}] must have barber_id, date, start_time and end_time`
      });
    }
  }

  try {
    const shopCheck = await pool.query(
      'SELECT id FROM shops WHERE id = $1 AND is_active = true',
      [shop_id]
    );
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }
    
    // One single query:
    //
    // CTE dates:
    //   generates next 9 calendar days starting from today
    //
    // CTE working_hours:
    //   for each date + each barber resolves working hours
    //   exception takes priority over weekly schedule
    //   only keeps barbers who are actually working that day
    //
    // CTE all_slots:
    //   generates slots every 30 minutes for each barber on each date
    //   filters out:
    //     past slots (when date is today)
    //     slots that don't fit within working hours
    //
    // CTE valid_slots:
    //   filters out slots that conflict with existing appointments
    //
    // CTE grouped:
    //   groups valid slots per date per barber
    //   only keeps barbers with at least one slot
    //
    // CTE ranked_dates:
    //   ranks dates by order
    //   we use this to pick only first 3 dates that have slots
    //
    // Final SELECT:
    //   returns only first 3 dates

    const result = await pool.query(
      `WITH dates AS (
         SELECT generate_series(
           CURRENT_DATE,
           CURRENT_DATE + '8 days'::interval,
           '1 day'::interval
         )::date AS date
       ),
       working_hours AS (
         SELECT
           d.date,
           b.id   AS barber_id,
           b.name AS barber_name,
           CASE WHEN e.id IS NOT NULL THEN e.start_time
                ELSE ws.start_time
           END AS start_time,
           CASE WHEN e.id IS NOT NULL THEN e.end_time
                ELSE ws.end_time
           END AS end_time
         FROM dates d
         JOIN barbers b ON b.shop_id = $1 AND b.is_active = true
         LEFT JOIN barber_schedules ws
           ON ws.barber_id = b.id
           AND ws.day_of_week = EXTRACT(DOW FROM d.date)
         LEFT JOIN barber_schedule_exceptions e
           ON e.barber_id = b.id
           AND e.exception_date = d.date
         WHERE
           -- Only keep barbers who are working this day
           CASE
             WHEN e.id IS NOT NULL THEN e.is_day_off
             WHEN ws.id IS NOT NULL THEN ws.is_day_off
             ELSE true
           END = false
           AND (
             CASE WHEN e.id IS NOT NULL THEN e.start_time
                  ELSE ws.start_time
             END
           ) IS NOT NULL
       ),
       all_slots AS (
         SELECT
           wh.date,
           wh.barber_id,
           wh.barber_name,
           slot::time AS slot_time
         FROM working_hours wh,
         generate_series(
           (wh.date + wh.start_time)::timestamp,
           (wh.date + wh.end_time)::timestamp - ($2 || ' minutes')::interval,
           '30 minutes'::interval
         ) AS slot
         WHERE
           -- Filter out past slots when date is today
           (wh.date + slot::time)::timestamp > NOW()
           -- Slot + duration must finish within working hours
           AND (slot::time + ($2 || ' minutes')::interval) <= wh.end_time
       ),
       valid_slots AS (
         SELECT
           s.date,
           s.barber_id,
           s.barber_name,
           s.slot_time
         FROM all_slots s
         WHERE NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.barber_id = s.barber_id
             AND a.appointment_date = s.date
             AND a.status IN ('pending', 'confirmed')
             AND a.start_time < (s.slot_time + ($2 || ' minutes')::interval)
             AND a.end_time   >  s.slot_time
         )
       ),
       grouped AS (
         SELECT
           date,
           barber_id,
           barber_name,
           array_agg(
             to_char(slot_time, 'HH24:MI')
             ORDER BY slot_time
           ) AS available_slots
         FROM valid_slots
         GROUP BY date, barber_id, barber_name
         HAVING count(*) > 0
       ),
       ranked_dates AS (
         SELECT
           date,
           DENSE_RANK() OVER (ORDER BY date) AS date_rank
         FROM grouped
         GROUP BY date
       )
       SELECT
         g.date,
         g.barber_id,
         g.barber_name,
         g.available_slots
       FROM grouped g
       JOIN ranked_dates rd ON rd.date = g.date
       WHERE rd.date_rank <= 3
       ORDER BY g.date, g.barber_name`,
      [shop_id, totalDurationMinutes]
    );

    // Group results by date
    const availabilityMap = {};
    for (const row of result.rows) {
      const dateStr = row.date;

      if (!availabilityMap[dateStr]) {
        availabilityMap[dateStr] = [];
      }

      // Apply already_chosen filters in JS
      // These depend on frontend state not DB data
      let filteredSlots = row.available_slots;

      if (already_chosen.length > 0) {
        const chosenOnThisDate = already_chosen.filter(p => p.date === dateStr);

        if (chosenOnThisDate.length > 0) {
          const earliestStart = chosenOnThisDate.reduce((min, p) =>
            p.start_time < min ? p.start_time : min,
            chosenOnThisDate[0].start_time
          );
          const latestEnd = chosenOnThisDate.reduce((max, p) =>
            p.end_time > max ? p.end_time : max,
            chosenOnThisDate[0].end_time
          );

          filteredSlots = filteredSlots.filter(slot => {
            const slotStart = toMinutes(slot);
            const slotEnd = slotStart + totalDurationMinutes;

            // Barber conflict — same barber already chosen at overlapping time
            const isBarberConflict = chosenOnThisDate.some(chosen => {
              if (Number(chosen.barber_id) !== row.barber_id) return false;
              const chosenStart = toMinutes(chosen.start_time);
              const chosenEnd = toMinutes(chosen.end_time);
              return slotStart < chosenEnd && slotEnd > chosenStart;
            });

            if (isBarberConflict) return false;

            // Proximity rule
            // Person N must start within the group's time window
            const earliestStartMin = toMinutes(earliestStart);
            const latestEndMin = toMinutes(latestEnd);

            if (slotStart < earliestStartMin || slotStart > latestEndMin) return false;

            return true;
          });
        } else {
          // already_chosen exists but none on this date
          // person 2 cannot book on a different date than person 1
          filteredSlots = [];
        }
      }

      if (filteredSlots.length > 0) {
        availabilityMap[dateStr].push({
          barber_id: row.barber_id,
          barber_name: row.barber_name,
          available_slots: filteredSlots
        });
      }
    }

    // Convert map to array and remove dates with no barbers after filtering
    const availabilityByDate = Object.entries(availabilityMap)
      .filter(([_, barbers]) => barbers.length > 0)
      .map(([date, barbers]) => ({ date, barbers }));

    if (availabilityByDate.length === 0 && already_chosen.length > 0) {
      return res.json({
        availability: [],
        no_slots_reason: 'no_barbers_available_near_group_time',
        message: 'No available slots close to the group time. You can book this person on a different date or change person 1 time.'
      });
    }

    res.json({
      availability: availabilityByDate,
      total_duration: totalDurationMinutes,
      customer_type
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};// ----------------------------
// POST /api/appointments
// Create solo or group appointment
// Uses a DB transaction — if anything fails nothing is saved
// Each guest has their own barber_id and start_time
// ----------------------------
export const createAppointment = async (req, res) => {
  const {
    shop_id,
    barber_id,
    service_id,
    customer_id,
    appointment_date,
    start_time,
    customer_type = 'adult',
    notes,
    guests // [{ type: 'adult'|'child', barber_id: number, start_time: 'HH:MM' }]
  } = req.body;

  // --- Basic validation ---
  if (!hasValue(shop_id) || !hasValue(barber_id) || !hasValue(service_id) || !hasValue(customer_id) || !hasValue(appointment_date) || !hasValue(start_time)) {
    return res.status(400).json({ message: 'shop_id, barber_id, service_id, customer_id, appointment_date and start_time are required' });
  }

  if (!['adult', 'child'].includes(customer_type)) {
    return res.status(400).json({ message: 'customer_type must be adult or child' });
  }

  // --- Validate guests array ---
  if (guests !== undefined) {
    if (!Array.isArray(guests)) {
      return res.status(400).json({ message: 'guests must be an array' });
    }

    for (const [index, guest] of guests.entries()) {
      if (!['adult', 'child'].includes(guest.type)) {
        return res.status(400).json({ message: `Guest ${index + 1}: type must be adult or child` });
      }
      if (!guest.barber_id) {
        return res.status(400).json({ message: `Guest ${index + 1}: barber_id is required` });
      }
      if (!guest.start_time) {
        return res.status(400).json({ message: `Guest ${index + 1}: start_time is required` });
      }
    }
  }

  // Build the full list of all appointments we want to make
  // [{ barber_id, start_time, customer_type }]
  const allBookings = [
    { barber_id: Number(barber_id), start_time, customer_type },
    ...(guests || []).map(g => ({
      barber_id: Number(g.barber_id),
      start_time: g.start_time,
      customer_type: g.type
    }))
  ];

  // Check for overlapping times within the same barber across the group
  // Two people can use the same barber as long as their times don't overlap
  for (let i = 0; i < allBookings.length; i++) {
    for (let j = i + 1; j < allBookings.length; j++) {
      const a = allBookings[i];
      const b = allBookings[j];
      if (a.barber_id !== b.barber_id) continue;

      // We don't know durations yet — we'll do this check properly inside the transaction
      // after we fetch the service. Flag duplicate barber for now if same start time.
      if (a.start_time === b.start_time) {
        return res.status(400).json({
          message: 'Two people in the group cannot have the same barber at the same time'
        });
      }
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // --- Validate shop ---
    const shopCheck = await client.query(
      'SELECT id FROM shops WHERE id = $1 AND is_active = true',
      [shop_id]
    );
    if (shopCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Shop not found' });
    }

    // --- Get service ---
    const serviceResult = await client.query(
      'SELECT * FROM services WHERE id = $1 AND shop_id = $2 AND is_active = true',
      [service_id, shop_id]
    );
    if (serviceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Service not found in this shop' });
    }

    const service = serviceResult.rows[0];

    if (customer_type === 'child' && !service.child_duration_minutes) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This service does not have a child tier' });
    }

    if (guests && guests.some(g => g.type === 'child') && !service.child_duration_minutes) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This service does not have a child tier' });
    }

    // --- Validate customer ---
    const customerCheck = await client.query(
      'SELECT id FROM customers WHERE id = $1',
      [customer_id]
    );
    if (customerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Customer not found' });
    }

    // --- Get duration and price for a given customer type ---
    const getServiceDetails = (type) => {
      if (type === 'child') {
        return { duration: service.child_duration_minutes, price: service.child_price };
      }
      return { duration: service.duration_minutes, price: service.price };
    };

    // --- Validate all barbers and check conflicts in one loop ---
    // Get all unique barber IDs across the group
    const uniqueBarberIds = [...new Set(allBookings.map(b => b.barber_id))];

    // Fetch all relevant barbers in one query
    const barbersResult = await client.query(
      `SELECT id FROM barbers
       WHERE id = ANY($1::int[])
         AND shop_id = $2
         AND is_active = true`,
      [uniqueBarberIds, shop_id]
    );

    if (barbersResult.rows.length !== uniqueBarberIds.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'One or more barbers not found in this shop' });
    }

    // Build a complete picture of what each booking looks like with end times
    const resolvedBookings = allBookings.map(booking => {
      const details = getServiceDetails(booking.customer_type);
      const endTime = toTimeString(toMinutes(booking.start_time) + details.duration);
      return {
        ...booking,
        end_time: endTime,
        duration: details.duration,
        price: details.price
      };
    });

    // Now check properly for overlapping times within the same barber
    for (let i = 0; i < resolvedBookings.length; i++) {
      for (let j = i + 1; j < resolvedBookings.length; j++) {
        const a = resolvedBookings[i];
        const b = resolvedBookings[j];
        if (a.barber_id !== b.barber_id) continue;

        const aStart = toMinutes(a.start_time);
        const aEnd = toMinutes(a.end_time);
        const bStart = toMinutes(b.start_time);
        const bEnd = toMinutes(b.end_time);

        if (aStart < bEnd && aEnd > bStart) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            message: `Two people in the group have overlapping times with barber ${a.barber_id}`
          });
        }
      }
    }

    // Fetch all existing appointments for all involved barbers on this date in one query
    const existingAppointments = await client.query(
      `SELECT barber_id, start_time, end_time
       FROM appointments
       WHERE barber_id = ANY($1::int[])
         AND appointment_date = $2
         AND status IN ('pending', 'confirmed')`,
      [uniqueBarberIds, appointment_date]
    );

    // Build map of barber_id → booked slots
    const bookedByBarber = {};
    for (const appt of existingAppointments.rows) {
      const bid = appt.barber_id;
      if (!bookedByBarber[bid]) bookedByBarber[bid] = [];
      bookedByBarber[bid].push(appt);
    }

    // Check each booking for conflicts against existing appointments
    for (const booking of resolvedBookings) {
      const booked = bookedByBarber[booking.barber_id] || [];
      const slotStart = toMinutes(booking.start_time);
      const slotEnd = toMinutes(booking.end_time);

      const hasConflict = booked.some(b => {
        return slotStart < toMinutes(b.end_time) && slotEnd > toMinutes(b.start_time);
      });

      if (hasConflict) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `Barber ${booking.barber_id} is no longer available at ${booking.start_time}. Please refresh and try again.`
        });
      }
    }

    // --- All checks passed — insert all appointments ---
    const groupId = resolvedBookings.length > 1 ? uuidv4() : null;
    const insertedAppointments = [];

    for (const booking of resolvedBookings) {
      const result = await client.query(
        `INSERT INTO appointments
          (shop_id, barber_id, service_id, customer_id, group_id, customer_type,
           appointment_date, start_time, end_time, price, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          shop_id,
          booking.barber_id,
          service_id,
          customer_id,
          groupId,
          booking.customer_type,
          appointment_date,
          booking.start_time,
          booking.end_time,
          booking.price,
          booking.barber_id === Number(barber_id) ? (notes ?? null) : 'Guest booking'
        ]
      );
      insertedAppointments.push(result.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Appointment booked ✅',
      appointments: insertedAppointments,
      is_group: resolvedBookings.length > 1,
      group_id: groupId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

// ----------------------------
// GET /api/appointments/token/:token
// Get appointment details by cancellation token (customer's booking page)
// ----------------------------
export const getAppointmentByToken = async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         a.*,
         b.name AS barber_name,
         s.name AS service_name,
         sh.name AS shop_name,
         sh.phone AS shop_phone,
         st.cancellation_window_hours
       FROM appointments a
       JOIN barbers b ON a.barber_id = b.id
       JOIN services s ON a.service_id = s.id
       JOIN shops sh ON a.shop_id = sh.id
       JOIN shop_settings st ON a.shop_id = st.shop_id
       WHERE a.cancellation_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const appointment = result.rows[0];

    // Calculate if the customer can still cancel
    const appointmentDateTime = new Date(
      `${appointment.appointment_date.toISOString().split('T')[0]}T${appointment.start_time}`
    );
    const hoursUntilAppointment = (appointmentDateTime - new Date()) / (1000 * 60 * 60);
    const canCancel =
      hoursUntilAppointment >= appointment.cancellation_window_hours &&
      ['pending', 'confirmed'].includes(appointment.status);

    res.json({ appointment, can_cancel: canCancel });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/appointments/token/:token/cancel
// Customer cancels using their unique token
// ----------------------------
export const cancelByCustomer = async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT a.*, st.cancellation_window_hours
       FROM appointments a
       JOIN shop_settings st ON a.shop_id = st.shop_id
       WHERE a.cancellation_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const appointment = result.rows[0];

    if (!['pending', 'confirmed'].includes(appointment.status)) {
      return res.status(400).json({ message: `Cannot cancel an appointment that is already ${appointment.status}` });
    }

    const appointmentDateTime = new Date(
      `${appointment.appointment_date.toISOString().split('T')[0]}T${appointment.start_time}`
    );
    const hoursUntilAppointment = (appointmentDateTime - new Date()) / (1000 * 60 * 60);

    if (hoursUntilAppointment < appointment.cancellation_window_hours) {
      return res.status(400).json({
        message: `Cancellation window has passed. You can only cancel at least ${appointment.cancellation_window_hours} hours before your appointment.`
      });
    }

    // Cancel this appointment — if part of a group cancel all linked appointments
    if (appointment.group_id) {
      await pool.query(
        `UPDATE appointments SET status = 'cancelled' WHERE group_id = $1`,
        [appointment.group_id]
      );
    } else {
      await pool.query(
        `UPDATE appointments SET status = 'cancelled' WHERE cancellation_token = $1`,
        [token]
      );
    }

    res.json({ message: 'Appointment cancelled ✅' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/appointments/shop/:shopId
// Get all appointments for a shop (shop admin view)
// Optional filters: status, date
// ----------------------------
export const getShopAppointments = async (req, res) => {
  const { shopId } = req.params;
  const { status, date } = req.query;

  try {
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    let query = `
      SELECT
        a.*,
        b.name AS barber_name,
        s.name AS service_name,
        c.name AS customer_name,
        c.phone AS customer_phone
      FROM appointments a
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      JOIN customers c ON a.customer_id = c.id
      WHERE a.shop_id = $1
    `;

    const params = [shopId];

    if (status) {
      params.push(status);
      query += ` AND a.status = $${params.length}`;
    }

    if (date) {
      params.push(date);
      query += ` AND a.appointment_date = $${params.length}`;
    }

    query += ' ORDER BY a.appointment_date ASC, a.start_time ASC';

    const result = await pool.query(query, params);
    res.json({ appointments: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/appointments/barber/:barberId
// Get appointments for a specific barber (barber panel view)
// Optional filters: status, date
// ----------------------------
export const getBarberAppointments = async (req, res) => {
  const { barberId } = req.params;
  const { shop_id, status, date } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  try {
    const barberCheck = await pool.query(
      'SELECT id FROM barbers WHERE id = $1 AND shop_id = $2',
      [barberId, shop_id]
    );
    if (barberCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    let query = `
      SELECT
        a.*,
        s.name AS service_name,
        c.name AS customer_name,
        c.phone AS customer_phone
      FROM appointments a
      JOIN services s ON a.service_id = s.id
      JOIN customers c ON a.customer_id = c.id
      WHERE a.barber_id = $1
    `;

    const params = [barberId];

    if (status) {
      params.push(status);
      query += ` AND a.status = $${params.length}`;
    }

    if (date) {
      params.push(date);
      query += ` AND a.appointment_date = $${params.length}`;
    }

    query += ' ORDER BY a.appointment_date ASC, a.start_time ASC';

    const result = await pool.query(query, params);
    res.json({ appointments: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/appointments/:id/status
// Barber confirms, marks complete or no_show
// ----------------------------
export const updateAppointmentStatus = async (req, res) => {
  const { id } = req.params;
  const { shop_id, barber_id, status } = req.body;

  if (!shop_id || !barber_id || !status) {
    return res.status(400).json({ message: 'shop_id, barber_id and status are required' });
  }

  const allowedStatuses = ['confirmed', 'completed', 'no_show'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: `status must be one of: ${allowedStatuses.join(', ')}` });
  }

  try {
    const barberCheck = await pool.query(
      'SELECT id FROM barbers WHERE id = $1 AND shop_id = $2',
      [barber_id, shop_id]
    );
    if (barberCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    const appointmentCheck = await pool.query(
      'SELECT id, status FROM appointments WHERE id = $1 AND barber_id = $2',
      [id, barber_id]
    );
    if (appointmentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found for this barber' });
    }

    if (status === 'confirmed' && appointmentCheck.rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Only a pending appointment can be confirmed' });
    }

    if (['completed', 'no_show'].includes(status) && appointmentCheck.rows[0].status !== 'confirmed') {
      return res.status(400).json({ message: 'Only a confirmed appointment can be marked completed or no_show' });
    }

    const result = await pool.query(
      'UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    res.json({ message: `Appointment marked as ${status} ✅`, appointment: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/appointments/:id/cancel
// Barber or shop admin cancels with a reason
// TODO: Send WhatsApp message to customer (Step 7 - Twilio)
// ----------------------------
export const cancelByBarber = async (req, res) => {
  const { id } = req.params;
  const { shop_id, barber_id, reason } = req.body;

  if (!shop_id || !reason) {
    return res.status(400).json({ message: 'shop_id and reason are required' });
  }

  try {
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // If barber_id is provided → barber cancelling their own appointment
    // If not provided → shop admin cancelling any appointment in their shop
    const appointmentResult = barber_id
      ? await pool.query(
          'SELECT * FROM appointments WHERE id = $1 AND barber_id = $2 AND shop_id = $3',
          [id, barber_id, shop_id]
        )
      : await pool.query(
          'SELECT * FROM appointments WHERE id = $1 AND shop_id = $2',
          [id, shop_id]
        );

    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const appointment = appointmentResult.rows[0];

    if (appointment.status === 'cancelled') {
      return res.status(400).json({ message: 'Appointment is already cancelled' });
    }

    // Cancel this appointment — if part of a group cancel all linked appointments
    if (appointment.group_id) {
      await pool.query(
        `UPDATE appointments
         SET status = 'cancelled', cancellation_reason = $1
         WHERE group_id = $2`,
        [reason, appointment.group_id]
      );
    } else {
      await pool.query(
        `UPDATE appointments
         SET status = 'cancelled', cancellation_reason = $1
         WHERE id = $2`,
        [reason, id]
      );
    }

    // TODO: Send WhatsApp message to customer (Step 7 - Twilio)

    res.json({ message: 'Appointment cancelled ✅', reason });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

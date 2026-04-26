/*
    ToDo:
    - Continue going through the code to fully undersetand it
    - Add comments to explain complex logic, especially the SQL queries
    - Check latest claude edits to implemnt important changes to the code
*/



import pool from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

// ----------------------------
// HELPER: Get barber working hours for a specific date
// Checks exceptions first, falls back to weekly schedule
// ----------------------------
const getBarberWorkingHours = async (barberId, date) => {
  // date is a string like '2026-05-01'
  // day_of_week: 0=Sunday, 1=Monday, ..., 6=Saturday
  const dayOfWeek = new Date(date).getDay();

  // Check exceptions first
  const exceptionResult = await pool.query(
    `SELECT * FROM barber_schedule_exceptions
     WHERE barber_id = $1 AND exception_date = $2`,
    [barberId, date]
  );

  if (exceptionResult.rows.length > 0) {
    const exception = exceptionResult.rows[0];
    if (exception.is_day_off) return null; // barber is off this day
    return { start_time: exception.start_time, end_time: exception.end_time };
  }

  // No exception — use weekly schedule
  const scheduleResult = await pool.query(
    `SELECT * FROM barber_schedules
     WHERE barber_id = $1 AND day_of_week = $2`,
    [barberId, dayOfWeek]
  );

  if (scheduleResult.rows.length === 0) return null;
  const schedule = scheduleResult.rows[0];
  if (schedule.is_day_off) return null;

  return { start_time: schedule.start_time, end_time: schedule.end_time };
};

// ----------------------------
// HELPER: Generate time slots
// Takes working hours and service duration, returns array of slot start times
// e.g. ['09:00', '09:30', '10:00', ...]
// ----------------------------
const generateTimeSlots = (startTime, endTime, durationMinutes) => {
  const slots = [];

  // Convert 'HH:MM:SS' or 'HH:MM' to total minutes from midnight
  const toMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Convert total minutes back to 'HH:MM' string
  const toTimeString = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const mins = (totalMinutes % 60).toString().padStart(2, '0');
    return `${hours}:${mins}`;
  };

  const startMinutes = toMinutes(startTime);
  const endMinutes = toMinutes(endTime);

  // last slot must start early enough to finish before end time
  for (let current = startMinutes; current + durationMinutes <= endMinutes; current += durationMinutes) {
    slots.push(toTimeString(current));
  }

  return slots;
};

// ----------------------------
// GET /api/appointments/slots
// Get available time slots for a barber on a specific date
// Query params: shop_id, barber_id, service_id, date
// ----------------------------
export const getAvailableSlots = async (req, res) => {
  const { shop_id, barber_id, service_id, date } = req.query;

  if (!shop_id || !barber_id || !service_id || !date) {
    return res.status(400).json({ message: 'shop_id, barber_id, service_id and date are required' });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(date) < today) {
    return res.status(400).json({ message: 'date cannot be in the past' });
  }

  try {
    // Round trip 1: Validate shop, barber, service all in one query
    const validationResult = await pool.query(
      `SELECT 
         b.id AS barber_id,
         s.duration_minutes
       FROM barbers b
       JOIN services s ON s.id = $3
       JOIN shops sh ON sh.id = $1
       WHERE b.id = $2 
         AND b.shop_id = $1 
         AND b.is_active = true
         AND s.shop_id = $1
         AND s.is_active = true
         AND sh.is_active = true`,
      [shop_id, barber_id, service_id]
    );

    if (validationResult.rows.length === 0) {
      return res.status(404).json({ message: 'Shop, barber or service not found' });
    }

    const durationMinutes = validationResult.rows[0].duration_minutes;

    /*
      ! I don't understand this sql query at all but it works and is super efficient 
      ! with only 1 round trip to the database, so I'm keeping it as is for now.
      ! I will need to study it in depth later to fully understand how it works, especially
      ! the generate_series and NOT EXISTS parts.
    */

    // Round trip 2: Get working hours + generate slots + filter booked slots all in one query
    // Step 1 inside SQL: resolve working hours (exception overrides weekly schedule)
    // Step 2 inside SQL: generate_series creates every possible slot
    // Step 3 inside SQL: NOT EXISTS filters out slots that conflict with existing bookings


    // If no rows returned and it's because barber is off (not just fully booked)
    const isWorkingResult = await pool.query(
      `SELECT
         CASE WHEN e.id IS NOT NULL THEN e.is_day_off
              ELSE ws.is_day_off
         END AS is_day_off
       FROM barber_schedules ws
       LEFT JOIN barber_schedule_exceptions e
         ON e.barber_id = ws.barber_id AND e.exception_date = $2
       WHERE ws.barber_id = $1
         AND ws.day_of_week = EXTRACT(DOW FROM $2::date)`,
      [barber_id, date]
    );

    if (isWorkingResult.rows.length === 0 || isWorkingResult.rows[0].is_day_off) {
      return res.json({ available_slots: [], message: 'Barber is not working on this day' });
    }

    const availableSlots = slotsResult.rows.map(row =>
      row.slot_time.slice(0, 5) // format as 'HH:MM'
    );

    res.json({ available_slots: availableSlots, date, barber_id, service_id });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// POST /api/appointments
// Create a new appointment (or group booking)
// ----------------------------
export const createAppointment = async (req, res) => {
  const {
    shop_id,
    barber_id,
    service_id,
    customer_id,
    appointment_date,
    start_time,
    notes,
    party_size // number of people including the main customer (1 = solo, 2+ = group)
  } = req.body;

  if (!shop_id || !barber_id || !service_id || !customer_id || !appointment_date || !start_time) {
    return res.status(400).json({ message: 'shop_id, barber_id, service_id, customer_id, appointment_date and start_time are required' });
  }

  try {
    // Check shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Check barber belongs to shop
    const barberCheck = await pool.query(
      'SELECT id FROM barbers WHERE id = $1 AND shop_id = $2 AND is_active = true',
      [barber_id, shop_id]
    );
    if (barberCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    // Get service details
    const serviceResult = await pool.query(
      'SELECT * FROM services WHERE id = $1 AND shop_id = $2 AND is_active = true',
      [service_id, shop_id]
    );
    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Service not found in this shop' });
    }

    const service = serviceResult.rows[0];

    // Check customer exists
    const customerCheck = await pool.query('SELECT id FROM customers WHERE id = $1', [customer_id]);
    if (customerCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Calculate end_time based on service duration
    const toMinutes = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const toTimeString = (totalMinutes) => {
      const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
      const mins = (totalMinutes % 60).toString().padStart(2, '0');
      return `${hours}:${mins}`;
    };

    const startMinutes = toMinutes(start_time);
    const endMinutes = startMinutes + service.duration_minutes;
    const end_time = toTimeString(endMinutes);

    // Check the slot is still available
    const conflictCheck = await pool.query(
      `SELECT id FROM appointments
       WHERE barber_id = $1
       AND appointment_date = $2
       AND status IN ('pending', 'confirmed')
       AND start_time < $3 AND end_time > $4`,
      [barber_id, appointment_date, end_time, start_time]
    );
    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({ message: 'This time slot is no longer available' });
    }

    // Generate a group_id if party_size > 1
    const groupId = (party_size && party_size > 1) ? uuidv4() : null;

    // Create the main appointment
    const appointmentResult = await pool.query(
      `INSERT INTO appointments 
        (shop_id, barber_id, service_id, customer_id, group_id, appointment_date, start_time, end_time, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [shop_id, barber_id, service_id, customer_id, groupId, appointment_date, start_time, end_time, notes || null]
    );

    const mainAppointment = appointmentResult.rows[0];
    const appointments = [mainAppointment];

    // Handle group booking — auto assign additional barbers for guests
    if (party_size && party_size > 1) {
      // Get all other active barbers in this shop except the chosen one
      const otherBarbersResult = await pool.query(
        `SELECT id FROM barbers 
         WHERE shop_id = $1 AND id != $2 AND is_active = true`,
        [shop_id, barber_id]
      );

      const otherBarbers = otherBarbersResult.rows;
      const guestCount = party_size - 1;

      for (let i = 0; i < guestCount; i++) {
        // Find an available barber for this guest at the same time
        let assignedBarberId = null;

        for (const candidate of otherBarbers) {
          // Check if this barber is working that day
          const workingHours = await getBarberWorkingHours(candidate.id, appointment_date);
          if (!workingHours) continue;

          // Check if barber has no conflict at this time slot
          const conflict = await pool.query(
            `SELECT id FROM appointments
             WHERE barber_id = $1
             AND appointment_date = $2
             AND status IN ('pending', 'confirmed')
             AND start_time < $3 AND end_time > $4`,
            [candidate.id, appointment_date, end_time, start_time]
          );

          if (conflict.rows.length === 0) {
            assignedBarberId = candidate.id;
            break; // found an available barber for this guest
          }
        }

        if (!assignedBarberId) {
          // No available barber found for this guest
          // Roll back all appointments we just created
          await pool.query(
            `DELETE FROM appointments WHERE group_id = $1`,
            [groupId]
          );
          await pool.query('DELETE FROM appointments WHERE id = $1', [mainAppointment.id]);
          return res.status(409).json({
            message: `Not enough available barbers for a group of ${party_size} at this time. Please choose a different time or reduce the party size.`
          });
        }

        // Book the guest appointment
        const guestAppointment = await pool.query(
          `INSERT INTO appointments
            (shop_id, barber_id, service_id, customer_id, group_id, appointment_date, start_time, end_time, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [shop_id, assignedBarberId, service_id, customer_id, groupId, appointment_date, start_time, end_time, 'Guest booking (auto-assigned)']
        );

        appointments.push(guestAppointment.rows[0]);
      }
    }

    res.status(201).json({
      message: 'Appointment booked ✅',
      appointments,
      is_group: party_size > 1,
      group_id: groupId
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/appointments/token/:token
// Get appointment details by cancellation token (for customer view)
// ----------------------------
export const getAppointmentByToken = async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         a.*,
         b.name AS barber_name,
         s.name AS service_name,
         s.duration_minutes,
         s.price,
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

    // Calculate if cancellation is still allowed
    const appointmentDateTime = new Date(`${appointment.appointment_date.toISOString().split('T')[0]}T${appointment.start_time}`);
    const now = new Date();
    const hoursUntilAppointment = (appointmentDateTime - now) / (1000 * 60 * 60);
    const canCancel = hoursUntilAppointment >= appointment.cancellation_window_hours && appointment.status === 'confirmed';

    res.json({ appointment, can_cancel: canCancel });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/appointments/cancel/customer/:token
// Customer cancels their appointment using their token
// ----------------------------
export const cancelAppointmentByCustomer = async (req, res) => {
  const { token } = req.params;

  try {
    // Get appointment and shop settings
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

    // Can only cancel pending or confirmed appointments
    if (!['pending', 'confirmed'].includes(appointment.status)) {
      return res.status(400).json({ message: `Cannot cancel an appointment that is ${appointment.status}` });
    }

    // Check cancellation window
    const appointmentDateTime = new Date(`${appointment.appointment_date.toISOString().split('T')[0]}T${appointment.start_time}`);
    const now = new Date();
    const hoursUntilAppointment = (appointmentDateTime - now) / (1000 * 60 * 60);

    if (hoursUntilAppointment < appointment.cancellation_window_hours) {
      return res.status(400).json({
        message: `Cancellation window has passed. You can only cancel at least ${appointment.cancellation_window_hours} hours before the appointment.`
      });
    }

    // Cancel the appointment
    await pool.query(
      `UPDATE appointments SET status = 'cancelled' WHERE cancellation_token = $1`,
      [token]
    );

    // If part of a group booking cancel all appointments in the group
    if (appointment.group_id) {
      await pool.query(
        `UPDATE appointments SET status = 'cancelled' WHERE group_id = $1`,
        [appointment.group_id]
      );
    }

    res.json({ message: 'Appointment cancelled ✅' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/appointments/shop/:shopId
// Get all appointments for a shop
// Optional query: status, date
// ----------------------------
export const getShopAppointments = async (req, res) => {
  const { shopId } = req.params;
  const { status, date } = req.query;

  try {
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Build query dynamically based on optional filters
    let query = `
      SELECT 
        a.*,
        b.name AS barber_name,
        s.name AS service_name,
        s.price,
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
// Get appointments for a specific barber
// Optional query: status, date, shop_id
// ----------------------------
export const getBarberAppointments = async (req, res) => {
  const { barberId } = req.params;
  const { status, date, shop_id } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  try {
    // Check barber belongs to shop
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
        s.duration_minutes,
        s.price,
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
// PUT /api/appointments/status/:id
// Barber accepts or declines an appointment
// ----------------------------
export const updateAppointmentStatus = async (req, res) => {
  const { id } = req.params;
  const { shop_id, barber_id, status } = req.body;

  if (!shop_id || !barber_id || !status) {
    return res.status(400).json({ message: 'shop_id, barber_id and status are required' });
  }

  // Barber can only set these statuses from this route
  const allowedStatuses = ['confirmed', 'completed', 'no_show'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(', ')}` });
  }

  try {
    // Check barber belongs to shop
    const barberCheck = await pool.query(
      'SELECT id FROM barbers WHERE id = $1 AND shop_id = $2',
      [barber_id, shop_id]
    );
    if (barberCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    // Check appointment belongs to this barber
    const appointmentCheck = await pool.query(
      'SELECT id, status FROM appointments WHERE id = $1 AND barber_id = $2',
      [id, barber_id]
    );
    if (appointmentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found for this barber' });
    }

    // Can only update pending appointments to confirmed
    if (status === 'confirmed' && appointmentCheck.rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Can only confirm a pending appointment' });
    }

    const result = await pool.query(
      `UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );

    res.json({ message: `Appointment ${status} ✅`, appointment: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/appointments/cancel/barber/:id
// Barber or shop admin cancels an appointment with a reason
// WhatsApp message will be added here later when we integrate Twilio
// ----------------------------
export const cancelAppointmentByBarber = async (req, res) => {
  const { id } = req.params;
  const { shop_id, barber_id, reason } = req.body;

  if (!shop_id || !reason) {
    return res.status(400).json({ message: 'shop_id and reason are required' });
  }

  try {
    // Check shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Build the appointment lookup query
    // If barber_id is provided it means a barber is cancelling (only their own appointments)
    // If only shop_id is provided it means the shop admin is cancelling (any appointment in the shop)
    let appointmentResult;
    if (barber_id) {
      appointmentResult = await pool.query(
        'SELECT * FROM appointments WHERE id = $1 AND barber_id = $2 AND shop_id = $3',
        [id, barber_id, shop_id]
      );
    } else {
      appointmentResult = await pool.query(
        'SELECT * FROM appointments WHERE id = $1 AND shop_id = $2',
        [id, shop_id]
      );
    }

    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const appointment = appointmentResult.rows[0];

    if (appointment.status === 'cancelled') {
      return res.status(400).json({ message: 'Appointment is already cancelled' });
    }

    // Cancel the appointment and save the reason
    await pool.query(
      `UPDATE appointments 
       SET status = 'cancelled', cancellation_reason = $1 
       WHERE id = $2`,
      [reason, id]
    );

    // If part of a group cancel all appointments in the group
    if (appointment.group_id) {
      await pool.query(
        `UPDATE appointments 
         SET status = 'cancelled', cancellation_reason = $1
         WHERE group_id = $2`,
        [reason, appointment.group_id]
      );
    }

    // TODO: Send WhatsApp message to customer (Twilio - coming in Step 7)

    res.json({ message: 'Appointment cancelled ✅', reason });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

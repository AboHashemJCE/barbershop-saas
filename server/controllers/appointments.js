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
 
  const { shop_id, appointment_date, notes, persons } = req.body;
  const customer_id = req.user.id;

  // --- Basic validation ---
  if (!shop_id || !customer_id || !appointment_date || !persons) {
    return res.status(400).json({ message: 'shop_id, customer_id, appointment_date and persons are required' });
  }

  if (!Array.isArray(persons) || persons.length === 0) {
    return res.status(400).json({ message: 'persons must be a non-empty array' });
  }

  for (const [index, person] of persons.entries()) {
    if (!person.barber_id || !person.start_time || !person.customer_type || !person.services) {
      return res.status(400).json({
        message: `Person ${index + 1}: barber_id, start_time, customer_type and services are required`
      });
    }

    if (!['adult', 'child'].includes(person.customer_type)) {
      return res.status(400).json({
        message: `Person ${index + 1}: customer_type must be adult or child`
      });
    }

    if (!Array.isArray(person.services) || person.services.length === 0) {
      return res.status(400).json({
        message: `Person ${index + 1}: services must be a non-empty array of service ids`
      });
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

    // --- Validate customer ---
    const customerCheck = await client.query(
      'SELECT id FROM customers WHERE id = $1',
      [customer_id]
    );
    if (customerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Customer not found' });
    }

    // --- Validate appointment_date is not in the past ---
    // Use PostgreSQL to stay consistent with timezone set in pool.js
    const dateCheck = await client.query(
      `SELECT
         $1::date >= CURRENT_DATE AS is_valid,
         $1::date = CURRENT_DATE AS is_today`,
      [appointment_date]
    );

    if (!dateCheck.rows[0].is_valid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'appointment_date cannot be in the past' });
    }

    // --- If booking is for today validate each person's start_time is not in the past ---
    if (dateCheck.rows[0].is_today) {
      for (const [index, person] of persons.entries()) {
        const timeCheck = await client.query(
          `SELECT (CURRENT_DATE + $1::time)::timestamp > NOW() AS is_valid`,
          [person.start_time]
        );
        if (!timeCheck.rows[0].is_valid) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            message: `Person ${index + 1}: start_time ${person.start_time} is in the past`
          });
        }
      }
    }

    // --- Get all unique service ids and barber ids across all persons ---
    const allServiceIds = [...new Set(persons.flatMap(p => p.services))];
    const allBarberIds = [...new Set(persons.map(p => Number(p.barber_id)))];

    // --- Fetch all services in one query ---
    const servicesResult = await client.query(
      `SELECT id, name, duration_minutes, price, child_duration_minutes, child_price
       FROM services
       WHERE id = ANY($1::int[])
         AND shop_id = $2
         AND is_active = true`,
      [allServiceIds, shop_id]
    );

    const servicesMap = {};
    for (const service of servicesResult.rows) {
      servicesMap[service.id] = service;
    }

    // Check all requested services were found
    for (const [index, person] of persons.entries()) {
      for (const serviceId of person.services) {
        if (!servicesMap[serviceId]) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            message: `Person ${index + 1}: service ${serviceId} not found in this shop`
          });
        }
      }
    }

    // --- Fetch all barbers in one query ---
    const barbersResult = await client.query(
      `SELECT id FROM barbers
       WHERE id = ANY($1::int[])
         AND shop_id = $2
         AND is_active = true`,
      [allBarberIds, shop_id]
    );

    if (barbersResult.rows.length !== allBarberIds.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'One or more barbers not found in this shop' });
    }

    // --- Fetch working hours for all barbers on this date in one query ---
    // Use PostgreSQL to extract day of week to avoid timezone issues
    const workingHoursResult = await client.query(
      `SELECT
         b.id AS barber_id,
         CASE WHEN e.id IS NOT NULL THEN e.is_day_off
              WHEN ws.id IS NOT NULL THEN ws.is_day_off
              ELSE true
         END AS is_day_off,
         CASE WHEN e.id IS NOT NULL THEN e.start_time
              ELSE ws.start_time
         END AS start_time,
         CASE WHEN e.id IS NOT NULL THEN e.end_time
              ELSE ws.end_time
         END AS end_time
       FROM barbers b
       LEFT JOIN barber_schedules ws
         ON ws.barber_id = b.id
         AND ws.day_of_week = EXTRACT(DOW FROM $2::date)
       LEFT JOIN barber_schedule_exceptions e
         ON e.barber_id = b.id
         AND e.exception_date = $2
       WHERE b.id = ANY($1::int[])`,
      [allBarberIds, appointment_date]
    );

    const workingHoursMap = {};
    for (const row of workingHoursResult.rows) {
      workingHoursMap[row.barber_id] = row;
    }

    // --- Fetch all existing appointments for all barbers on this date in one query ---
    const existingAppointments = await client.query(
      `SELECT barber_id, start_time, end_time
       FROM appointments
       WHERE barber_id = ANY($1::int[])
         AND appointment_date = $2
         AND status IN ('pending', 'confirmed')`,
      [allBarberIds, appointment_date]
    );

    const bookedByBarber = {};
    for (const appt of existingAppointments.rows) {
      if (!bookedByBarber[appt.barber_id]) bookedByBarber[appt.barber_id] = [];
      bookedByBarber[appt.barber_id].push(appt);
    }

    // --- Resolve each person's details ---
    const resolvedPersons = [];

    for (const [index, person] of persons.entries()) {
      const barberId = Number(person.barber_id);
      const workingHours = workingHoursMap[barberId];

      if (!workingHours || workingHours.is_day_off) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `Person ${index + 1}: barber ${barberId} is not working on this day`
        });
      }

      // Calculate total duration and price
      let totalDuration = 0;
      let totalPrice = 0;
      const resolvedServices = [];

      for (const serviceId of person.services) {
        const service = servicesMap[serviceId];

        if (person.customer_type === 'child' && !service.child_duration_minutes) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            message: `Person ${index + 1}: service "${service.name}" does not have a child tier`
          });
        }

        const duration = person.customer_type === 'child'
          ? service.child_duration_minutes
          : service.duration_minutes;

        const price = person.customer_type === 'child'
          ? service.child_price
          : service.price;

        totalDuration += duration;
        totalPrice += parseFloat(price);

        resolvedServices.push({
          service_id: serviceId,
          service_name: service.name,
          customer_type: person.customer_type,
          price: parseFloat(price),
          duration_minutes: duration
        });
      }

      const endTime = toTimeString(toMinutes(person.start_time) + totalDuration);

      // Check slot fits within barber working hours
      if (
        toMinutes(person.start_time) < toMinutes(workingHours.start_time) ||
        toMinutes(endTime) > toMinutes(workingHours.end_time)
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `Person ${index + 1}: selected time is outside barber ${barberId} working hours`
        });
      }

      // Check no conflict with existing appointments
      const booked = bookedByBarber[barberId] || [];
      const hasConflict = booked.some(b =>
        toMinutes(person.start_time) < toMinutes(b.end_time) &&
        toMinutes(endTime) > toMinutes(b.start_time)
      );

      if (hasConflict) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `Person ${index + 1}: barber ${barberId} is no longer available at ${person.start_time}. Please refresh and try again.`
        });
      }

      resolvedPersons.push({
        barber_id: barberId,
        start_time: person.start_time,
        end_time: endTime,
        customer_type: person.customer_type,
        total_duration: totalDuration,
        total_price: totalPrice,
        services: resolvedServices
      });
    }

    // --- Check for overlapping times within the same barber across the group ---
    for (let i = 0; i < resolvedPersons.length; i++) {
      for (let j = i + 1; j < resolvedPersons.length; j++) {
        const a = resolvedPersons[i];
        const b = resolvedPersons[j];

        if (a.barber_id !== b.barber_id) continue;

        if (
          toMinutes(a.start_time) < toMinutes(b.end_time) &&
          toMinutes(a.end_time) > toMinutes(b.start_time)
        ) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            message: `Person ${i + 1} and Person ${j + 1} have overlapping times with barber ${a.barber_id}`
          });
        }
      }
    }

    // --- All checks passed — bulk insert all appointments ---
    const groupId = resolvedPersons.length > 1 ? uuidv4() : null;

    // Build bulk insert for appointments
    // All appointments inserted in one query
    const appointmentValues = resolvedPersons.map((person, i) => 
      `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${i * 11 + 5}, $${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${i * 11 + 10}, $${i * 11 + 11})`
    ).join(', ');

    const appointmentParams = resolvedPersons.flatMap(person => [
      shop_id,
      person.barber_id,
      customer_id,
      groupId,
      person.customer_type,
      appointment_date,
      person.start_time,
      person.end_time,
      person.total_price,
      person.total_duration,
      notes ?? null
    ]);

    const appointmentsResult = await client.query(
      `INSERT INTO appointments
        (shop_id, barber_id, customer_id, group_id, customer_type,
         appointment_date, start_time, end_time, total_price,
         total_duration_minutes, notes)
       VALUES ${appointmentValues}
       RETURNING *`,
      appointmentParams
    );

    const insertedAppointments = appointmentsResult.rows;

    // Build bulk insert for appointment_services
    // All services for all persons inserted in one query
    const allServices = resolvedPersons.flatMap((person, personIndex) =>
      person.services.map(service => ({
        appointment_id: insertedAppointments[personIndex].id,
        ...service
      }))
    );

    const serviceValues = allServices.map((_, i) =>
      `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`
    ).join(', ');

    const serviceParams = allServices.flatMap(s => [
      s.appointment_id,
      s.service_id,
      s.service_name,
      s.customer_type,
      s.price,
      s.duration_minutes
    ]);

    await client.query(
      `INSERT INTO appointment_services
        (appointment_id, service_id, service_name, customer_type, price, duration_minutes)
       VALUES ${serviceValues}`,
      serviceParams
    );

    await client.query('COMMIT');

    // Build response with services attached to each appointment
    const response = insertedAppointments.map((appt, i) => ({
      ...appt,
      services: resolvedPersons[i].services
    }));

    res.status(201).json({
      message: 'Appointment booked ✅',
      appointments: response,
      is_group: resolvedPersons.length > 1,
      group_id: groupId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
  }
};// ----------------------------
// GET /api/appointments/token/:token
// Get appointment details by cancellation token (customer's booking page)
// ----------------------------
export const getAppointmentByToken = async (req, res) => {
  const { token } = req.params;

  try {
    // One query gets appointment + shop info + cancellation window
        const appointmentResult = await pool.query(
      `SELECT
        a.*,
        b.name AS barber_name,
        sh.name AS shop_name,
        sh.phone AS shop_phone,
        st.cancellation_window_hours,
        (
          (a.appointment_date + a.start_time)::timestamp - NOW() >
          (st.cancellation_window_hours || ' hours')::interval
          AND a.status IN ('pending', 'confirmed')
        ) AS can_cancel
      FROM appointments a
      JOIN barbers b ON a.barber_id = b.id
      JOIN shops sh ON a.shop_id = sh.id
      JOIN shop_settings st ON a.shop_id = st.shop_id
      WHERE a.cancellation_token = $1`,
      [token]
    );
    if (appointmentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const appointment = appointmentResult.rows[0];

    // One query gets services + group appointments together
    // using a UNION to avoid two separate round trips
    const [servicesResult, groupResult] = await Promise.all([
      // Get services for this appointment
      pool.query(
        `SELECT
           service_id,
           service_name,
           customer_type,
           price,
           duration_minutes
         FROM appointment_services
         WHERE appointment_id = $1`,
        [appointment.id]
      ),

      // Get all appointments in the group if group booking
      // Returns empty if not a group booking
      appointment.group_id
        ? pool.query(
            `SELECT
               a.id,
               a.cancellation_token,
               a.customer_type,
               a.start_time,
               a.end_time,
               a.total_price,
               a.total_duration_minutes,
               a.status,
               b.name AS barber_name,
               array_agg(
                 json_build_object(
                   'service_name', aps.service_name,
                   'price', aps.price,
                   'duration_minutes', aps.duration_minutes
                 )
               ) AS services
             FROM appointments a
             JOIN barbers b ON a.barber_id = b.id
             JOIN appointment_services aps ON aps.appointment_id = a.id
             WHERE a.group_id = $1
             GROUP BY a.id, b.name
             ORDER BY a.start_time ASC`,
            [appointment.group_id]
          )
        : { rows: [] }
    ]);

    res.json({
      appointment: {
        ...appointment,
        services: servicesResult.rows
      },
      group_appointments: groupResult.rows,
      can_cancel: appointment.can_cancel
    });
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
  const { cancel_group = false } = req.body;

  if (typeof cancel_group !== 'boolean') {
    return res.status(400).json({ message: 'cancel_group must be a boolean' });
  }

  try {
    // Get appointment and cancellation window
    const result = await pool.query(
      `SELECT
         a.*,
         st.cancellation_window_hours,
         (
           (a.appointment_date + a.start_time)::timestamp - NOW() >
           (st.cancellation_window_hours || ' hours')::interval
         ) AS within_window
       FROM appointments a
       JOIN shop_settings st ON a.shop_id = st.shop_id
       WHERE a.cancellation_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    const appointment = result.rows[0];

    // Check appointment can be cancelled
    if (!['pending', 'confirmed'].includes(appointment.status)) {
      return res.status(400).json({
        message: `Cannot cancel an appointment that is already ${appointment.status}`
      });
    }

    // Check cancellation window for this appointment
    if (!appointment.within_window) {
      return res.status(400).json({
        message: `Cancellation window has passed. You can only cancel at least ${appointment.cancellation_window_hours} hours before your appointment. Please contact the shop.`
      });
    }

    // If cancelling entire group check ALL group members are within window
    if (cancel_group && appointment.group_id) {
      const groupWindowCheck = await pool.query(
        `SELECT COUNT(*) AS outside_window
         FROM appointments a
         JOIN shop_settings st ON a.shop_id = st.shop_id
         WHERE a.group_id = $1
           AND a.status IN ('pending', 'confirmed')
           AND (a.appointment_date + a.start_time)::timestamp - NOW() <=
               (st.cancellation_window_hours || ' hours')::interval`,
        [appointment.group_id]
      );

      if (parseInt(groupWindowCheck.rows[0].outside_window) > 0) {
        return res.status(400).json({
          message: 'Cannot cancel the entire group — one or more appointments are within the cancellation window. Please contact the shop.'
        });
      }

      // Cancel all group appointments
      await pool.query(
        `UPDATE appointments
         SET status = 'cancelled'
         WHERE group_id = $1
           AND status IN ('pending', 'confirmed')`,
        [appointment.group_id]
      );

      return res.json({ message: 'All group appointments cancelled ✅' });
    }

    // Cancel just this appointment
    await pool.query(
      `UPDATE appointments
       SET status = 'cancelled'
       WHERE cancellation_token = $1`,
      [token]
    );

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

    // Build query dynamically based on optional filters
    let conditions = 'WHERE a.shop_id = $1';
    const params = [shopId];

    if (status) {
      params.push(status);
      conditions += ` AND a.status = $${params.length}`;
    }

    if (date) {
      params.push(date);
      conditions += ` AND a.appointment_date = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         a.*,
         b.name AS barber_name,
         c.name AS customer_name,
         c.phone AS customer_phone,
         json_agg(
           json_build_object(
             'service_id', aps.service_id,
             'service_name', aps.service_name,
             'customer_type', aps.customer_type,
             'price', aps.price,
             'duration_minutes', aps.duration_minutes
           )
         ) AS services
       FROM appointments a
       JOIN barbers b ON a.barber_id = b.id
       JOIN customers c ON a.customer_id = c.id
       JOIN appointment_services aps ON aps.appointment_id = a.id
       ${conditions}
       GROUP BY a.id, b.name, c.name, c.phone
       ORDER BY a.appointment_date ASC, a.start_time ASC`,
      params
    );

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

    let conditions = 'WHERE a.barber_id = $1';
    const params = [barberId];

    if (status) {
      params.push(status);
      conditions += ` AND a.status = $${params.length}`;
    }

    if (date) {
      params.push(date);
      conditions += ` AND a.appointment_date = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         a.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
         json_agg(
           json_build_object(
             'service_id', aps.service_id,
             'service_name', aps.service_name,
             'customer_type', aps.customer_type,
             'price', aps.price,
             'duration_minutes', aps.duration_minutes
           )
         ) AS services
       FROM appointments a
       JOIN customers c ON a.customer_id = c.id
       JOIN appointment_services aps ON aps.appointment_id = a.id
       ${conditions}
       GROUP BY a.id, c.name, c.phone
       ORDER BY a.appointment_date ASC, a.start_time ASC`,
      params
    );

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

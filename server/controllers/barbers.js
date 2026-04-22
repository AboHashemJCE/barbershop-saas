import pool from '../db/pool.js';

// ----------------------------
// POST /api/barbers
// Create a new barber for a shop
// ----------------------------
export const createBarber = async (req, res) => {
  const { shop_id, name, email, password, phone } = req.body;

  if (!shop_id || !name || !email || !password) {
    return res.status(400).json({ message: 'shop_id, name, email and password are required' });
  }

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    const result = await pool.query(
      `INSERT INTO barbers (shop_id, name, email, password, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, shop_id, name, email, phone, is_active, created_at`,
      [shop_id, name, email, password, phone]
    );

        const barber = result.rows[0];

    // Automatically insert a default weekly schedule for the new barber
    // Mon-Fri 9am-5pm, Sat-Sun off
    const defaultSchedule = [
      { day_of_week: 0, is_day_off: true,  start_time: null,    end_time: null    }, // Sunday
      { day_of_week: 1, is_day_off: false, start_time: '09:00', end_time: '17:00' }, // Monday
      { day_of_week: 2, is_day_off: false, start_time: '09:00', end_time: '17:00' }, // Tuesday
      { day_of_week: 3, is_day_off: false, start_time: '09:00', end_time: '17:00' }, // Wednesday
      { day_of_week: 4, is_day_off: false, start_time: '09:00', end_time: '17:00' }, // Thursday
      { day_of_week: 5, is_day_off: false, start_time: '09:00', end_time: '17:00' }, // Friday
      { day_of_week: 6, is_day_off: true,  start_time: null,    end_time: null    }, // Saturday
    ];

    for (const day of defaultSchedule) {
      await pool.query(
        `INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time, is_day_off)
         VALUES ($1, $2, $3, $4, $5)`,
        [barber.id, day.day_of_week, day.start_time, day.end_time, day.is_day_off]
      );
    }


    res.status(201).json( { 
        message: 'Barber created ✅', 
        barber,
        default_schedule: 'Mon-Fri 9:00am-5:00pm, Sat-Sun off'
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A barber with this email already exists' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/barbers/shop/:shopId
// Get all barbers for a shop
// ----------------------------
export const getShopBarbers = async (req, res) => {
  const { shopId } = req.params;

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    const result = await pool.query(
      `SELECT id, shop_id, name, email, phone, is_active, created_at
       FROM barbers
       WHERE shop_id = $1
       ORDER BY created_at ASC`,
      [shopId]
    );

    res.json({ barbers: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/barbers/:id
// Update a barber's info
// ----------------------------
export const updateBarber = async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.query;
  const { name, phone, is_active } = req.body;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Check the barber exists AND belongs to this shop
    const barberCheck = await pool.query(
      'SELECT id FROM barbers WHERE id = $1 AND shop_id = $2',
      [id, shop_id]
    );
    if (barberCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    const result = await pool.query(
      `UPDATE barbers
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           is_active = COALESCE($3, is_active)
       WHERE id = $4
       RETURNING id, shop_id, name, email, phone, is_active`,
      [name, phone, is_active, id]
    );

    res.json({ message: 'Barber updated ✅', barber: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// DELETE /api/barbers/:id
// Delete a barber
// ----------------------------
export const deleteBarber = async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id is required' });
  }

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Delete only if barber belongs to this shop
    const result = await pool.query(
      'DELETE FROM barbers WHERE id = $1 AND shop_id = $2 RETURNING id',
      [id, shop_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Barber not found in this shop' });
    }

    res.json({ message: 'Barber deleted ✅' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

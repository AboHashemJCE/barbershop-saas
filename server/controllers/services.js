import pool from '../db/pool.js';

// ----------------------------
// POST /api/services
// Create a new service for a shop
// ----------------------------
export const createService = async (req, res) => {
  const { shop_id, name, duration_minutes, price } = req.body;

  if (!shop_id || !name || !duration_minutes || !price) {
    return res.status(400).json({ message: 'shop_id, name, duration_minutes and price are required' });
  }

  // duration and price must be positive numbers
  if (duration_minutes <= 0 || price <= 0) {
    return res.status(400).json({ message: 'duration_minutes and price must be positive numbers' });
  }

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    const result = await pool.query(
      `INSERT INTO services (shop_id, name, duration_minutes, price)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [shop_id, name, duration_minutes, price]
    );

    res.status(201).json({ message: 'Service created ✅', service: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/services/shop/:shopId
// Get all active services for a shop
// ----------------------------
export const getShopServices = async (req, res) => {
  const { shopId } = req.params;

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    const result = await pool.query(
      `SELECT id, shop_id, name, duration_minutes, price, is_active
       FROM services
       WHERE shop_id = $1
       ORDER BY name ASC`,
      [shopId]
    );

    res.json({ services: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/services/:id
// Update a service
// ----------------------------
export const updateService = async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.query;
  const { name, duration_minutes, price, is_active } = req.body;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  // if provided, duration and price must be positive
  if (duration_minutes !== undefined && duration_minutes <= 0) {
    return res.status(400).json({ message: 'duration_minutes must be a positive number' });
  }
  if (price !== undefined && price <= 0) {
    return res.status(400).json({ message: 'price must be a positive number' });
  }

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Check service exists AND belongs to this shop
    const serviceCheck = await pool.query(
      'SELECT id FROM services WHERE id = $1 AND shop_id = $2',
      [id, shop_id]
    );
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Service not found in this shop' });
    }

    const result = await pool.query(
      `UPDATE services
       SET name = COALESCE($1, name),
           duration_minutes = COALESCE($2, duration_minutes),
           price = COALESCE($3, price),
           is_active = COALESCE($4, is_active)
       WHERE id = $5
       RETURNING *`,
      [name, duration_minutes, price, is_active, id]
    );

    res.json({ message: 'Service updated ✅', service: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// DELETE /api/services/:id
// Delete a service
// ----------------------------
export const deleteService = async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.query;

  if (!shop_id) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  try {
    // Check the shop exists
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // Delete only if service belongs to this shop
    const result = await pool.query(
      'DELETE FROM services WHERE id = $1 AND shop_id = $2 RETURNING id',
      [id, shop_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Service not found in this shop' });
    }

    res.json({ message: 'Service deleted ✅' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
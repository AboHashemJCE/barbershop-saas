import pool from '../db/pool.js';


const hasValue = (val) => val !== undefined && val !== null;

// ----------------------------
// POST /api/services
// Create a new service for a shop
// ----------------------------
export const createService = async (req, res) => {
  const { shop_id, name, duration_minutes, price, child_duration_minutes, child_price } = req.body;

  // Required fields
  if (!hasValue(shop_id) || !hasValue(name) || !hasValue(duration_minutes) || !hasValue(price)) {
    return res.status(400).json({ message: 'shop_id, name, duration_minutes and price are required' });
  }

  // Adult fields must be valid numbers
  if (typeof duration_minutes !== 'number' || duration_minutes <= 0) {
    return res.status(400).json({ message: 'duration_minutes must be a positive number' });
  }
  if (typeof price !== 'number' || price <= 0) {
    return res.status(400).json({ message: 'price must be a positive number' });
  }

  // Child fields are optional but must come together
  const hasChildDuration = hasValue(child_duration_minutes);
  const hasChildPrice = hasValue(child_price);

  if (hasChildDuration !== hasChildPrice) {
    return res.status(400).json({ message: 'child_price and child_duration_minutes must be provided together' });
  }

  if (hasChildDuration && (typeof child_duration_minutes !== 'number' || child_duration_minutes <= 0)) {
    return res.status(400).json({ message: 'child_duration_minutes must be a positive number' });
  }
  if (hasChildPrice && (typeof child_price !== 'number' || child_price <= 0)) {
    return res.status(400).json({ message: 'child_price must be a positive number' });
  }

  try {
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    const result = await pool.query(
      `INSERT INTO services (shop_id, name, duration_minutes, price, child_duration_minutes, child_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [shop_id, name, duration_minutes, price, child_duration_minutes ?? null, child_price ?? null]
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
      `SELECT id, shop_id, name, duration_minutes, price, child_duration_minutes, child_price, is_active
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
  const { name, duration_minutes, price, child_duration_minutes, child_price, is_active } = req.body;

  if (!hasValue(shop_id)) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  // Only validate fields that were actually provided
  if (hasValue(duration_minutes) && (typeof duration_minutes !== 'number' || duration_minutes <= 0)) {
    return res.status(400).json({ message: 'duration_minutes must be a positive number' });
  }
  if (hasValue(price) && (typeof price !== 'number' || price <= 0)) {
    return res.status(400).json({ message: 'price must be a positive number' });
  }
  if (hasValue(child_duration_minutes) && (typeof child_duration_minutes !== 'number' || child_duration_minutes <= 0)) {
    return res.status(400).json({ message: 'child_duration_minutes must be a positive number' });
  }
  if (hasValue(child_price) && (typeof child_price !== 'number' || child_price <= 0)) {
    return res.status(400).json({ message: 'child_price must be a positive number' });
  }

  try {
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    const serviceCheck = await pool.query(
      'SELECT id FROM services WHERE id = $1 AND shop_id = $2',
      [id, shop_id]
    );
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Service not found in this shop' });
    }


    // Figure out what child_price and child_duration_minutes will be after the update
    // If a new value is provided use it, otherwise keep the existing DB value
    const finalChildPrice = hasValue(child_price) ? child_price : existingService.child_price;
    const finalChildDuration = hasValue(child_duration_minutes) ? child_duration_minutes : existingService.child_duration_minutes;

    // After the update one cannot be set while the other is null
    if (hasValue(finalChildPrice) !== hasValue(finalChildDuration)) {
    return res.status(400).json({ message: 'child_price and child_duration_minutes must both be set or both be null' });
    }

    const result = await pool.query(
      `UPDATE services
       SET name = COALESCE($1, name),
           duration_minutes = COALESCE($2, duration_minutes),
           price = COALESCE($3, price),
           child_duration_minutes = COALESCE($4, child_duration_minutes),
           child_price = COALESCE($5, child_price),
           is_active = COALESCE($6, is_active)
       WHERE id = $7
       RETURNING *`,
      [
        name ?? null,
        duration_minutes ?? null,
        price ?? null,
        child_duration_minutes ?? null,
        child_price ?? null,
        is_active ?? null,
        id
      ]
    );

    res.json({ message: 'Service updated ✅', service: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
;

// ----------------------------
// DELETE /api/services/:id
// Delete a service
// ----------------------------
export const deleteService = async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.query;

  if (!hasValue(shop_id)) {
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

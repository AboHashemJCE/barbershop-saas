import pool from '../db/pool.js';

const hasValue = (val) => val !== undefined && val !== null;

// ----------------------------
// POST /api/services
// ----------------------------
export const createService = async (req, res) => {
  const { shop_id, name, duration_minutes, price, child_duration_minutes, child_price } = req.body;

  if (!hasValue(shop_id) || !hasValue(name) || !hasValue(duration_minutes) || !hasValue(price)) {
    return res.status(400).json({ message: 'shop_id, name, duration_minutes and price are required' });
  }

  // Shop admin can only create services for their own shop
  if (req.user.shop_id !== parseInt(shop_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  if (typeof duration_minutes !== 'number' || duration_minutes <= 0) {
    return res.status(400).json({ message: 'duration_minutes must be a positive number' });
  }
  if (typeof price !== 'number' || price <= 0) {
    return res.status(400).json({ message: 'price must be a positive number' });
  }

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
// Public route — no ownership check needed
// ----------------------------
export const getShopServices = async (req, res) => {
  const { shopId } = req.params;
  const { customer_type } = req.query;

  try {
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    // If customer_type is child only return services with child tier
    let query = `
      SELECT id, shop_id, name, duration_minutes, price,
             child_duration_minutes, child_price, is_active
      FROM services
      WHERE shop_id = $1
        AND is_active = true
    `;

    if (customer_type === 'child') {
      query += ' AND child_duration_minutes IS NOT NULL AND child_price IS NOT NULL';
    }

    query += ' ORDER BY name ASC';

    const result = await pool.query(query, [shopId]);
    res.json({ services: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/services/:id
// ----------------------------
export const updateService = async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.query;
  const { name, duration_minutes, price, child_duration_minutes, child_price, is_active } = req.body;

  if (!hasValue(shop_id)) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  // Shop admin can only update services in their own shop
  if (req.user.shop_id !== parseInt(shop_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

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
      'SELECT * FROM services WHERE id = $1 AND shop_id = $2',
      [id, shop_id]
    );
    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Service not found in this shop' });
    }

    const existingService = serviceCheck.rows[0];

    const finalChildPrice = hasValue(child_price) ? child_price : existingService.child_price;
    const finalChildDuration = hasValue(child_duration_minutes) ? child_duration_minutes : existingService.child_duration_minutes;

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
};

// ----------------------------
// DELETE /api/services/:id
// ----------------------------
export const deleteService = async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.query;

  if (!hasValue(shop_id)) {
    return res.status(400).json({ message: 'shop_id query parameter is required' });
  }

  // Shop admin can only delete services in their own shop
  if (req.user.shop_id !== parseInt(shop_id)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const shopCheck = await pool.query('SELECT id FROM shops WHERE id = $1', [shop_id]);
    if (shopCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

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

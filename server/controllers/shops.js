import pool from '../db/pool.js';

// ----------------------------
// POST /api/shops
// Create a new shop
// ----------------------------
export const createShop = async (req, res) => {
  const { name, slug, owner_email, owner_password, phone, address } = req.body;

  // Basic validation
  if (!name || !slug || !owner_email || !owner_password) {
    return res.status(400).json({ message: 'name, slug, owner_email and owner_password are required' });
  }

  try {
    // Insert the shop
    const shopResult = await pool.query(
      `INSERT INTO shops (name, slug, owner_email, owner_password, phone, address)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, slug, owner_email, owner_password, phone, address]
    );

    const shop = shopResult.rows[0];

    // Automatically create default shop settings for this shop
    await pool.query(
      `INSERT INTO shop_settings (shop_id, cancellation_window_hours)
       VALUES ($1, $2)`,
      [shop.id, 2]
    );

    res.status(201).json({ message: 'Shop created ✅', shop });
  } catch (error) {
    // Handle duplicate slug or email
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A shop with this slug or email already exists' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/shops
// Get all shops (for super admin)
// ----------------------------
export const getAllShops = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, owner_email, phone, address, is_active, created_at
       FROM shops
       ORDER BY created_at DESC`
    );

    res.json({ shops: result.rows });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// GET /api/shops/:slug
// Get a single shop by its slug (public route - for the shop page)
// ----------------------------
export const getShopBySlug = async (req, res) => {
  const { slug } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, slug, phone, address, is_active
       FROM shops
       WHERE slug = $1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Shop not found' });
    }

    const shop = result.rows[0];

    // If shop exists but is deactivated
    if (!shop.is_active) {
      return res.status(403).json({ message: 'This shop is currently inactive' });
    }

    res.json({ shop });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
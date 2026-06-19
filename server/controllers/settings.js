import pool from '../db/pool.js';

// ----------------------------
// GET /api/settings/:shopId
// ----------------------------
export const getShopSettings = async (req, res) => {
  const { shopId } = req.params;

  if (req.user.shop_id !== parseInt(shopId)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM shop_settings WHERE shop_id = $1',
      [shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Settings not found' });
    }

    res.json({ settings: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// PUT /api/settings/:shopId
// ----------------------------
export const updateShopSettings = async (req, res) => {
  const { shopId } = req.params;
  const { cancellation_window_hours } = req.body;

  if (req.user.shop_id !== parseInt(shopId)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  if (!cancellation_window_hours) {
    return res.status(400).json({ message: 'cancellation_window_hours is required' });
  }

  if (typeof cancellation_window_hours !== 'number' || cancellation_window_hours < 0) {
    return res.status(400).json({ message: 'cancellation_window_hours must be a positive number' });
  }

  try {
    const result = await pool.query(
      `UPDATE shop_settings
       SET cancellation_window_hours = $1
       WHERE shop_id = $2
       RETURNING *`,
      [cancellation_window_hours, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Settings not found' });
    }

    res.json({ message: 'Settings updated ✅', settings: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

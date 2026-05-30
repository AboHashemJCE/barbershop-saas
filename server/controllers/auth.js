import pool from '../db/pool.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ----------------------------
// HELPER: Generate JWT token
// ----------------------------
const generateToken = (payload, expiresIn) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

// ----------------------------
// HELPER: Validate phone number format
// Must be in international format e.g. +972599000000
// ----------------------------
const isValidPhone = (phone) => {
  return /^\+[1-9]\d{7,14}$/.test(phone);
};

// ----------------------------
// POST /api/auth/customer/request-otp
// Sends OTP via Twilio Verify WhatsApp channel
// If new customer, name is required
// ----------------------------
export const requestOtp = async (req, res) => {
  const { phone, name } = req.body;

  if (!phone) {
    return res.status(400).json({ message: 'phone is required' });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({ message: 'phone must be in international format e.g. +972599000000' });
  }

  try {
    // Check if customer exists
    const customerResult = await pool.query(
      'SELECT id FROM customers WHERE phone = $1',
      [phone]
    );

    const customerExists = customerResult.rows.length > 0;

    // New customer must provide name
    if (!customerExists && !name) {
      return res.status(400).json({
        message: 'name is required for new customers',
        is_new_customer: true
      });
    }

    // Create customer if new
    if (!customerExists) {
      await pool.query(
        'INSERT INTO customers (phone, name) VALUES ($1, $2)',
        [phone, name]
      );
    }

    // Send OTP via Twilio Verify WhatsApp channel
    // Twilio handles OTP generation, delivery, expiry and rate limiting
    await twilioClient.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({
        to: phone,
        channel: 'sms'
      });

    res.json({ message: 'OTP sent via WhatsApp ✅' });
  } catch (error) {
    // Handle Twilio specific errors clearly
    if (error.code === 60200) {
      return res.status(400).json({ message: 'Invalid phone number' });
    }
    if (error.code === 60203) {
      return res.status(429).json({ message: 'Too many OTP requests. Please wait before trying again.' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// POST /api/auth/customer/verify-otp
// Verifies OTP via Twilio Verify
// Returns JWT token if valid
// ----------------------------
export const verifyOtp = async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ message: 'phone and code are required' });
  }

  if (!isValidPhone(phone)) {
    return res.status(400).json({ message: 'phone must be in international format e.g. +972599000000' });
  }

  try {
    // Verify OTP with Twilio
    // Twilio checks: correct code, not expired, not already used, not too many attempts
    const verificationCheck = await twilioClient.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({
        to: phone,
        code
      });

    // Twilio returns status 'approved' if OTP is correct
    if (verificationCheck.status !== 'approved') {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }

    // Get customer
    const customerResult = await pool.query(
      'SELECT id, name, phone FROM customers WHERE phone = $1',
      [phone]
    );

    const customer = customerResult.rows[0];

    // Generate JWT token
    const token = generateToken(
      { id: customer.id, role: 'customer' },
      '7d'
    );

    res.json({
      message: 'Logged in ✅',
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone
      }
    });
  } catch (error) {
    if (error.code === 60200) {
      return res.status(400).json({ message: 'Invalid phone number' });
    }
    if (error.code === 60202) {
      return res.status(401).json({ message: 'Too many incorrect attempts. Please request a new OTP.' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// POST /api/auth/barber/login
// ----------------------------
export const barberLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, password, shop_id, is_active
       FROM barbers
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const barber = result.rows[0];

    if (!barber.is_active) {
      return res.status(403).json({ message: 'Your account has been deactivated. Please contact your shop admin.' });
    }

    const passwordMatch = await bcrypt.compare(password, barber.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(
      { id: barber.id, role: 'barber', shop_id: barber.shop_id },
      '7d'
    );

    res.json({
      message: 'Logged in ✅',
      token,
      barber: {
        id: barber.id,
        name: barber.name,
        email: barber.email,
        shop_id: barber.shop_id
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// POST /api/auth/shop/login
// ----------------------------
export const shopLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, owner_email, owner_password, is_active
       FROM shops
       WHERE owner_email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const shop = result.rows[0];

    if (!shop.is_active) {
      return res.status(403).json({ message: 'This shop has been deactivated. Please contact support.' });
    }

    const passwordMatch = await bcrypt.compare(password, shop.owner_password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(
      { id: shop.id, role: 'shop_admin', shop_id: shop.id },
      '7d'
    );

    res.json({
      message: 'Logged in ✅',
      token,
      shop: {
        id: shop.id,
        name: shop.name,
        email: shop.owner_email
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ----------------------------
// POST /api/auth/super-admin/login
// ----------------------------
export const superAdminLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password FROM super_admins WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const admin = result.rows[0];

    const passwordMatch = await bcrypt.compare(password, admin.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(
      { id: admin.id, role: 'super_admin' },
      '8h'
    );

    res.json({
      message: 'Logged in ✅',
      token,
      admin: {
        id: admin.id,
        email: admin.email
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

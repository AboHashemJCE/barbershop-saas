-- SHOPS
CREATE TABLE shops (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL, -- e.g. "kings-cuts" used in the URL /shop/kings-cuts
  owner_email VARCHAR(150) UNIQUE NOT NULL,
  owner_password TEXT NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- SHOP SETTINGS
CREATE TABLE shop_settings (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
  cancellation_window_hours INTEGER DEFAULT 2,
  UNIQUE(shop_id)
);

-- BARBERS
CREATE TABLE barbers (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- BARBER WEEKLY SCHEDULE
CREATE TABLE barber_schedules (
  id SERIAL PRIMARY KEY,
  barber_id INTEGER REFERENCES barbers(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME,
  end_time TIME,
  is_day_off BOOLEAN DEFAULT false,
  UNIQUE(barber_id, day_of_week)
);

-- BARBER SCHEDULE EXCEPTIONS (vacation, sick days, special hours)
CREATE TABLE barber_schedule_exceptions (
  id SERIAL PRIMARY KEY,
  barber_id INTEGER REFERENCES barbers(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_day_off BOOLEAN DEFAULT true,
  start_time TIME,
  end_time TIME,
  reason VARCHAR(100),
  UNIQUE(barber_id, exception_date)
);


-- SERVICES
CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,       -- e.g. "Haircut", "Beard Trim"
  duration_minutes INTEGER NOT NULL, -- how long the service takes
  price NUMERIC(10, 2) NOT NULL,
  is_active BOOLEAN DEFAULT true
);

-- CUSTOMERS
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL, -- phone is their identity (no password)
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- APPOINTMENTS
CREATE TABLE appointments (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
  barber_id INTEGER REFERENCES barbers(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  group_id UUID,                -- null if solo, shared UUID if group booking
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,       -- calculated from start_time + service duration
  status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, cancelled, completed, no_show
  cancellation_reason TEXT,     -- filled in when barber cancels
  cancellation_token UUID DEFAULT gen_random_uuid(), -- unique token for customer cancel button
  notes TEXT,                   -- any notes from customer
  created_at TIMESTAMP DEFAULT NOW()
);

-- SUPER ADMIN (just you)
CREATE TABLE super_admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(150) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- OTP TABLE (for customer whatsapp login)
CREATE TABLE otp_codes (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

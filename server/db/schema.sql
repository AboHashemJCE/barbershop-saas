-- SHOPS
CREATE TABLE shops (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
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

-- BARBER SCHEDULE EXCEPTIONS
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
  name VARCHAR(100) NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  child_duration_minutes INTEGER CHECK (child_duration_minutes > 0),
  child_price NUMERIC(10,2) CHECK (child_price > 0),
  is_active BOOLEAN DEFAULT true
);

-- CUSTOMERS
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- APPOINTMENTS
-- one row per person per booking session
-- total_price and total_duration are the sum of all services for this person
CREATE TABLE appointments (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
  barber_id INTEGER REFERENCES barbers(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  group_id UUID,
  customer_type VARCHAR(10) NOT NULL CHECK (customer_type IN ('adult', 'child')),
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  total_duration_minutes INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  cancellation_reason TEXT,
  cancellation_token UUID DEFAULT gen_random_uuid(),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- APPOINTMENT SERVICES
-- one row per service per appointment
-- stores a snapshot of price and duration at booking time
-- so if shop changes prices later old bookings are unaffected
CREATE TABLE appointment_services (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name VARCHAR(100) NOT NULL,
  customer_type VARCHAR(10) NOT NULL CHECK (customer_type IN ('adult', 'child')),
  price NUMERIC(10,2) NOT NULL,
  duration_minutes INTEGER NOT NULL
);

-- SUPER ADMIN
CREATE TABLE super_admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(150) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- OTP CODES
CREATE TABLE otp_codes (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

# Barbershop SaaS — Booking Platform (Backend)

A multi-tenant backend for barbershop appointment booking. Each shop manages its own barbers, services, and schedules on a single shared platform, with customers booking by phone number instead of a password.

> **Status:** Backend only. The API is functional and covers the full booking flow end-to-end, but there is no frontend yet — this repo is the server side of the product.

## Overview

The platform supports four roles per shop: **super admin**, **shop owner**, **barber**, and **customer**. A customer can book an appointment for themselves or for a group, choosing a different service per person, and the system finds real available time slots per barber — accounting for weekly schedules, one-off schedule exceptions, and existing bookings — rather than just checking a fixed calendar.

## Features

- **Multi-tenant data model** — shops, barbers, services, and schedules are fully scoped per shop on a single database and API.
- **Two authentication paths on one system** — customers log in passwordless via phone-number OTP (Twilio Verify); barbers, shop owners, and the super admin log in with a password, both issuing JWTs.
- **Role-based access control** — every route is guarded by JWT verification plus a role check (`customer`, `barber`, `shop_admin`, `super_admin`), enforced in middleware rather than left to the frontend.
- **Rate limiting** — a stricter limiter on `/api/auth` (10 requests / 15 min) on top of a general API limiter, to slow down brute-force and abuse.
- **Availability engine** — a single SQL query (via CTEs) resolves, per barber and per day, working hours from the weekly schedule, applies schedule exceptions, generates candidate time slots, and filters out anything that conflicts with an existing appointment — returning the next available days per barber.
- **Group booking in one transaction** — a customer can book multiple people at once, each with their own barber, services, and adult/child pricing; the whole booking is validated and written atomically (Postgres transaction with rollback on any failure), and when more than one person is booked, the system suggests nearby time slots — including across other barbers at the same shop — so the group can be seated close together.
- **Automated notifications** — booking confirmations, barber-confirmed updates, and cancellation notices are sent to the customer automatically via Twilio.
- **Parameterized SQL throughout** — every query uses `$1, $2…` placeholders; no string-built SQL.

## Tech Stack

- **Runtime:** Node.js, Express 5
- **Database:** PostgreSQL (`pg`)
- **Auth:** JSON Web Tokens (`jsonwebtoken`), `bcrypt` for staff passwords, Twilio Verify for customer OTP
- **Other:** `express-rate-limit`, `cors`, `dotenv`, `uuid`, `twilio` (WhatsApp/SMS notifications)

## Project Structure

```
server/
├── controllers/     # Route logic (appointments, auth, barbers, services, schedules, shops, settings)
├── routes/          # Express route definitions, grouped to match controllers
├── middleware/       # JWT authentication + role-based access control
├── db/
│   ├── pool.js       # PostgreSQL connection pool
│   └── schema.sql     # Full relational schema (shops, barbers, schedules, services, customers, appointments…)
├── utils/            # Input validation, response sanitization, Twilio WhatsApp helper
└── index.js          # App entry point, middleware wiring, rate limiters, route mounting
```

## Getting Started

1. **Install dependencies**
   ```bash
   cd server
   npm install
   ```

2. **Set up the database**

   Create a PostgreSQL database and run `db/schema.sql` against it to create all tables.

3. **Configure environment variables**

   Create a `.env` file inside `server/`:
   ```env
   PORT=5000

   DB_USER=your_db_user
   DB_HOST=localhost
   DB_NAME=barbershop
   DB_PASSWORD=your_db_password
   DB_PORT=5432

   JWT_SECRET=your_jwt_secret

   TWILIO_ACCOUNT_SID=your_twilio_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_SERVICE_SID=your_twilio_verify_service_sid
   TWILIO_WHATSAPP_FROM=your_twilio_whatsapp_number
   WHATSAPP_ENABLED=false
   ```
   With `WHATSAPP_ENABLED=false`, outgoing notifications are logged to the console instead of actually sent — useful for local development without a Twilio number.

4. **Run the server**
   ```bash
   npm run dev   # nodemon, auto-restarts on change
   # or
   npm start
   ```

   Health check: `GET /` → confirms the API is running.
   DB check: `GET /db-test` → confirms the database connection.

## API Overview

| Area | Base route | Notes |
|---|---|---|
| Auth | `/api/auth` | OTP request/verify for customers, password login for barber/shop/super-admin |
| Shops | `/api/shops` | Shop profile and settings |
| Barbers | `/api/barbers` | Barber management per shop |
| Services | `/api/services` | Services offered per shop |
| Schedules | `/api/schedules` | Weekly schedules + one-off exceptions per barber |
| Appointments | `/api/appointments` | Availability lookup, booking, cancellation, status updates |
| Settings | `/api/settings` | Shop-level configuration |

## Roadmap

- [ ] Customer/shop-facing frontend
- [ ] Shop owner dashboard for managing barbers, services, and appointments
- [ ] Deployment (currently local-only)

## Development Notes

Built solo as a way to learn multi-tenant backend design and authentication patterns beyond coursework. I used AI assistance during development but directed the architecture and debugged the logic myself, particularly the group-booking and availability logic, which went through several iterations before the scheduling edge cases worked correctly.

## Author

Mohammad Ashhab

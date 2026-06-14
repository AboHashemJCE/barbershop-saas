import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// When ready to go live:
// 1. Set up Twilio WhatsApp sender in console
// 2. Add TWILIO_WHATSAPP_FROM to .env
// 3. Set WHATSAPP_ENABLED=true in .env
// 4. No other changes needed

const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';

const twilioClient = WHATSAPP_ENABLED
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ----------------------------
// HELPER: Send a WhatsApp message
// ----------------------------
const sendWhatsApp = async (to, message) => {
  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp DISABLED] To: ${to}\nMessage: ${message}\n`);
    return;
  }

  await twilioClient.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: `whatsapp:${to}`,
    body: message
  });
};

// ----------------------------
// Send booking confirmation to customer
// Called after createAppointment succeeds
// ----------------------------
export const sendBookingConfirmation = async (customer, appointments, shopName) => {
  const date = appointments[0].appointment_date;
  const isGroup = appointments.length > 1;

  let message = `✅ Booking Confirmed!\n\n`;
  message += `Shop: ${shopName}\n`;
  message += `Date: ${date}\n\n`;

  for (const [index, appt] of appointments.entries()) {
    if (isGroup) message += `Person ${index + 1}:\n`;
    message += `  Barber: ${appt.barber_name}\n`;
    message += `  Time: ${appt.start_time.slice(0, 5)} - ${appt.end_time.slice(0, 5)}\n`;
    message += `  Services: ${appt.services.map(s => s.service_name).join(', ')}\n`;
    message += `  Price: ${appt.total_price}₪\n`;
    if (isGroup) message += '\n';
  }

  const total = appointments.reduce((sum, a) => sum + parseFloat(a.total_price), 0);
  if (isGroup) message += `Total: ${total}₪\n`;
  message += `\nStatus: Pending (waiting for barber confirmation)`;

  await sendWhatsApp(customer.phone, message);
};

// ----------------------------
// Send appointment confirmed notification to customer
// Called when barber confirms
// ----------------------------
export const sendAppointmentConfirmed = async (customerPhone, appointment) => {
  const message =
    `✅ Your appointment has been confirmed!\n\n` +
    `Barber: ${appointment.barber_name}\n` +
    `Date: ${appointment.appointment_date}\n` +
    `Time: ${appointment.start_time.slice(0, 5)} - ${appointment.end_time.slice(0, 5)}\n` +
    `We'll see you then!`;

  await sendWhatsApp(customerPhone, message);
};

// ----------------------------
// Send cancellation notification to customer
// Called when barber or shop admin cancels
// ----------------------------
export const sendCancellationNotice = async (customerPhone, appointment, reason) => {
  const message =
    `❌ Your appointment has been cancelled.\n\n` +
    `Barber: ${appointment.barber_name}\n` +
    `Date: ${appointment.appointment_date}\n` +
    `Time: ${appointment.start_time.slice(0, 5)}\n\n` +
    `Reason: ${reason}\n\n` +
    `Please book a new appointment at your convenience.`;

  await sendWhatsApp(customerPhone, message);
};

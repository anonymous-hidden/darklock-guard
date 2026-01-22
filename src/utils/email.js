const nodemailer = require('nodemailer');

async function sendEmail({ to, subject, text }) {
  if (!to) {
    console.log('[Email] Missing recipient; skipping');
    return false;
  }

  // Support both SMTP_* and EMAIL_* environment variable naming
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const user = process.env.EMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'Guardian Bot <no-reply@guardianpro.local>';
  const port = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587');
  const secure = process.env.EMAIL_SECURE === 'true' || process.env.SMTP_SECURE === 'true' || port === 465;

  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass }
      });
      await transporter.sendMail({ from, to, subject, text });
      console.log(`[Email] ✅ Sent to ${to} via ${host}:${port}`);
      return true;
    } catch (error) {
      console.error('[Email] ❌ Send failed:', error.message);
      console.log('[Email] Fallback console output:', { to, subject, text });
      return false;
    }
  } else {
    console.log('[Email] ⚠️ SMTP not configured (missing host/user/pass); printing email content:\n', { to, subject, text });
    return false;
  }
}

module.exports = { sendEmail };

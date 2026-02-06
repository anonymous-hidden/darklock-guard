/**
 * Email Service for Darklock Platform
 * Handles transactional emails (welcome, verification, password reset, etc.)
 * 
 * Supported Providers:
 * - Nodemailer (SMTP) - Default, works with Gmail, Outlook, custom SMTP
 * - SendGrid - High deliverability, production recommended
 * - AWS SES - Enterprise grade, cost effective
 * 
 * Environment Variables Required:
 * EMAIL_PROVIDER=smtp|sendgrid|ses (default: smtp)
 * 
 * For SMTP (Gmail, Outlook, etc.):
 * SMTP_HOST=smtp.gmail.com
 * SMTP_PORT=587
 * SMTP_USER=your-email@gmail.com
 * SMTP_PASS=your-app-password
 * SMTP_FROM=DarkLock <noreply@darklock.com>
 * 
 * For SendGrid:
 * SENDGRID_API_KEY=your-api-key
 * SENDGRID_FROM=noreply@darklock.com
 * 
 * For AWS SES:
 * AWS_REGION=us-east-1
 * AWS_ACCESS_KEY_ID=your-access-key
 * AWS_SECRET_ACCESS_KEY=your-secret-key
 * AWS_SES_FROM=noreply@darklock.com
 */

const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.provider = process.env.EMAIL_PROVIDER || 'smtp';
        this.enabled = this.validateConfig();
        
        if (this.enabled) {
            this.setupTransporter();
            console.log(`[Email] Service initialized with provider: ${this.provider}`);
        } else {
            console.log('[Email] Service disabled - missing configuration');
        }
    }

    /**
     * Validate email configuration
     */
    validateConfig() {
        const provider = this.provider;
        
        if (provider === 'smtp') {
            return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
        } else if (provider === 'sendgrid') {
            return !!process.env.SENDGRID_API_KEY;
        } else if (provider === 'ses') {
            return !!(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
        }
        
        return false;
    }

    /**
     * Setup email transporter based on provider
     */
    setupTransporter() {
        if (this.provider === 'smtp') {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
        } else if (this.provider === 'sendgrid') {
            // SendGrid via SMTP
            this.transporter = nodemailer.createTransport({
                host: 'smtp.sendgrid.net',
                port: 587,
                secure: false,
                auth: {
                    user: 'apikey',
                    pass: process.env.SENDGRID_API_KEY
                }
            });
        } else if (this.provider === 'ses') {
            // AWS SES via nodemailer-ses-transport would go here
            // For now, using SMTP interface
            this.transporter = nodemailer.createTransport({
                host: `email-smtp.${process.env.AWS_REGION}.amazonaws.com`,
                port: 587,
                secure: false,
                auth: {
                    user: process.env.AWS_ACCESS_KEY_ID,
                    pass: process.env.AWS_SECRET_ACCESS_KEY
                }
            });
        }
    }

    /**
     * Get the FROM email address
     */
    getFromAddress() {
        if (this.provider === 'smtp') {
            return process.env.SMTP_FROM || process.env.SMTP_USER;
        } else if (this.provider === 'sendgrid') {
            return process.env.SENDGRID_FROM || 'noreply@darklock.com';
        } else if (this.provider === 'ses') {
            return process.env.AWS_SES_FROM || 'noreply@darklock.com';
        }
    }

    /**
     * Send welcome email to new users
     */
    async sendWelcomeEmail(email, username) {
        if (!this.enabled) {
            console.log(`[Email] Skipped welcome email to ${email} (service disabled)`);
            return { success: false, reason: 'disabled' };
        }

        const mailOptions = {
            from: this.getFromAddress(),
            to: email,
            subject: 'Welcome to DarkLock Platform! 🛡️',
            html: this.getWelcomeEmailTemplate(username)
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log(`[Email] Welcome email sent to ${email}`);
            return { success: true };
        } catch (error) {
            console.error(`[Email] Failed to send welcome email to ${email}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send email verification link
     */
    async sendVerificationEmail(email, username, verificationToken) {
        if (!this.enabled) {
            console.log(`[Email] Skipped verification email to ${email} (service disabled)`);
            return { success: false, reason: 'disabled' };
        }

        const verificationUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/platform/auth/verify?token=${verificationToken}`;

        const mailOptions = {
            from: this.getFromAddress(),
            to: email,
            subject: 'Verify your DarkLock Platform account',
            html: this.getVerificationEmailTemplate(username, verificationUrl)
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log(`[Email] Verification email sent to ${email}`);
            return { success: true };
        } catch (error) {
            console.error(`[Email] Failed to send verification email to ${email}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send password reset email
     */
    async sendPasswordResetEmail(email, username, resetToken) {
        if (!this.enabled) {
            console.log(`[Email] Skipped password reset email to ${email} (service disabled)`);
            return { success: false, reason: 'disabled' };
        }

        const resetUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/platform/auth/reset-password?token=${resetToken}`;

        const mailOptions = {
            from: this.getFromAddress(),
            to: email,
            subject: 'Reset your DarkLock Platform password',
            html: this.getPasswordResetTemplate(username, resetUrl)
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log(`[Email] Password reset email sent to ${email}`);
            return { success: true };
        } catch (error) {
            console.error(`[Email] Failed to send password reset email to ${email}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Welcome Email Template
     */
    getWelcomeEmailTemplate(username) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; color: #e5e7eb; background: #0f1419; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: #1a1f2e; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
        .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 20px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
        .content { padding: 40px 30px; }
        .content h2 { color: #f9fafb; margin-top: 0; font-size: 18px; font-weight: 400; }
        .content p { color: #d1d5db; margin: 18px 0; font-size: 15px; }
        .intro { color: #d1d5db; font-size: 15px; line-height: 1.8; margin: 20px 0; }
        .button { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; text-decoration: none; border-radius: 8px; margin: 25px 0 20px 0; font-weight: 600; font-size: 15px; }
        .actions { margin: 30px 0; padding: 25px; background: #0f1419; border-radius: 8px; border-left: 3px solid #3b82f6; }
        .actions h3 { color: #f9fafb; margin: 0 0 18px 0; font-size: 16px; font-weight: 600; }
        .actions ul { margin: 0; padding: 0; list-style: none; }
        .actions li { margin: 12px 0; padding-left: 25px; position: relative; color: #d1d5db; font-size: 15px; }
        .actions li:before { content: "•"; position: absolute; left: 0; color: #3b82f6; font-weight: bold; font-size: 18px; }
        .security-notice { background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 18px; margin: 25px 0; border-radius: 4px; }
        .security-notice p { color: #fca5a5; margin: 0; font-size: 14px; }
        .footer { padding: 25px 30px; background: #0f1419; text-align: center; color: #6b7280; font-size: 13px; line-height: 1.6; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to Darklock</h1>
        </div>
        <div class="content">
            <h2>Hi ${username},</h2>
            
            <p class="intro">Welcome to Darklock. Your account has been successfully created.</p>
            
            <p class="intro">Darklock is designed to give you clear visibility and control over your security—sessions, authentication, and account protection—without relying on third-party identity providers.</p>
            
            <div class="actions">
                <h3>What you can do next:</h3>
                <ul>
                    <li>Sign in to your dashboard</li>
                    <li>Review your active sessions</li>
                    <li>Enable two-factor authentication for additional protection</li>
                    <li>Explore available applications and services</li>
                </ul>
            </div>
            
            <a href="${process.env.BASE_URL || 'http://localhost:3001'}/platform/dashboard" class="button">Go to Dashboard</a>
            
            <div class="security-notice">
                <p>If you did not create this account, please secure it immediately by resetting your password or contacting support.</p>
            </div>
            
            <p style="margin-top: 30px;">Thanks for choosing Darklock.</p>
        </div>
        <div class="footer">
            <p>© 2026 Darklock Platform. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Verification Email Template
     */
    getVerificationEmailTemplate(username, verificationUrl) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e5e7eb; background: #0f1419; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: #1a1f2e; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
        .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 20px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 28px; }
        .content { padding: 40px 30px; }
        .content h2 { color: #f9fafb; margin-top: 0; }
        .content p { color: #d1d5db; margin: 15px 0; }
        .button { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
        .warning { background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; color: #fca5a5; }
        .footer { padding: 20px 30px; background: #0f1419; text-align: center; color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Verify Your Email</h1>
        </div>
        <div class="content">
            <h2>Hi ${username}!</h2>
            <p>Thank you for signing up for DarkLock Platform. To complete your registration, please verify your email address by clicking the button below:</p>
            
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #9ca3af;">${verificationUrl}</p>
            
            <div class="warning">
                <strong>⚠️ Security Notice:</strong> This link will expire in 24 hours. If you didn't create an account with DarkLock, please ignore this email.
            </div>
        </div>
        <div class="footer">
            <p>© 2026 DarkLock Platform. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Password Reset Email Template
     */
    getPasswordResetTemplate(username, resetUrl) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #e5e7eb; background: #0f1419; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: #1a1f2e; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
        .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 20px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 28px; }
        .content { padding: 40px 30px; }
        .content h2 { color: #f9fafb; margin-top: 0; }
        .content p { color: #d1d5db; margin: 15px 0; }
        .button { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
        .warning { background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; color: #fca5a5; }
        .footer { padding: 20px 30px; background: #0f1419; text-align: center; color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔑 Reset Your Password</h1>
        </div>
        <div class="content">
            <h2>Hi ${username}!</h2>
            <p>We received a request to reset your DarkLock Platform password. Click the button below to create a new password:</p>
            
            <a href="${resetUrl}" class="button">Reset Password</a>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #9ca3af;">${resetUrl}</p>
            
            <div class="warning">
                <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour. If you didn't request a password reset, please ignore this email and your password will remain unchanged.
            </div>
        </div>
        <div class="footer">
            <p>© 2026 DarkLock Platform. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Send platform update notification email
     */
    async sendUpdateEmail(email, username, update) {
        if (!this.enabled) {
            console.log('[Email] Email service disabled, skipping update email');
            return;
        }

        const updateTypeLabel = update.type === 'major' ? 'Major Update' :
                                update.type === 'minor' ? 'Minor Update' : 'Bug Fix';

        const mailOptions = {
            from: this.getFromAddress(),
            to: email,
            subject: `Darklock Platform Update: v${update.version} - ${update.title}`,
            html: this.generateUpdateEmailHTML(username, update, updateTypeLabel)
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log(`[Email] Update notification sent to: ${email}`);
        } catch (err) {
            console.error('[Email] Failed to send update email:', err);
            throw err;
        }
    }

    /**
     * Generate update notification email HTML
     */
    generateUpdateEmailHTML(username, update, updateTypeLabel) {
        const updateUrl = `${this.getBaseUrl()}/platform/update`;
        
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Platform Update</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f; color: #ffffff;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #16161d 0%, #1c1c26 100%); border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);">
                    <tr>
                        <td style="background: linear-gradient(135deg, #6366f1, #7c3aed); padding: 40px 40px 30px; text-align: center;">
                            <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff;">
                                🚀 Platform Update
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px;">
                            <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #e5e7eb;">
                                Hi ${username},
                            </p>
                            <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #e5e7eb;">
                                We've just released a new update to the Darklock Platform!
                            </p>
                            <div style="background: #0a0a0f; border: 1px solid #2a2a3a; border-radius: 8px; padding: 24px; margin-bottom: 30px;">
                                <div style="margin-bottom: 16px;">
                                    <span style="display: inline-block; padding: 4px 12px; background: rgba(99, 102, 241, 0.15); border: 1px solid #6366f1; border-radius: 6px; font-size: 13px; font-weight: 600; color: #6366f1; font-family: 'Monaco', 'Courier New', monospace;">
                                        v${update.version}
                                    </span>
                                    <span style="display: inline-block; padding: 4px 10px; margin-left: 8px; background: ${update.type === 'major' ? 'rgba(239, 68, 68, 0.15)' : update.type === 'minor' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(34, 197, 94, 0.15)'}; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: ${update.type === 'major' ? '#ef4444' : update.type === 'minor' ? '#3b82f6' : '#22c55e'};">
                                        ${updateTypeLabel}
                                    </span>
                                </div>
                                <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600; color: #ffffff;">
                                    ${update.title}
                                </h2>
                                <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #9ca3af; white-space: pre-wrap;">
                                    ${update.content.substring(0, 300)}${update.content.length > 300 ? '...' : ''}
                                </p>
                            </div>
                            <div style="text-align: center; margin-bottom: 30px;">
                                <a href="${updateUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6366f1, #7c3aed); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                                    View Full Update
                                </a>
                            </div>
                            <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #9ca3af;">
                                Want to change your email preferences? You can manage your notification settings in your 
                                <a href="${this.getBaseUrl()}/platform/dashboard" style="color: #6366f1; text-decoration: none;">account settings</a>.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #0a0a0f; padding: 30px; text-align: center; border-top: 1px solid #2a2a3a;">
                            <p style="margin: 0 0 10px; font-size: 14px; color: #6b7280;">
                                Darklock Platform
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #4b5563;">
                                This email was sent to ${email} because you opted in to receive platform updates.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;
    }
}

// Export singleton instance
module.exports = new EmailService();

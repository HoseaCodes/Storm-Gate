import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import Logger from './logger.js';

const logger = new Logger('email');

// Email configuration
let transporter = null;

const initializeTransporter = () => {
  if (!transporter) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      logger.warn('Email configuration missing. Set EMAIL_USER and EMAIL_PASS environment variables to enable email functionality.');
      return null;
    }

    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    logger.info('Email transporter initialized successfully');
  }
  return transporter;
};

// Generate approval token
export const generateApprovalToken = (userData) => {
  return jwt.sign(userData, process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET, { expiresIn: '24h' });
};

// Verify approval token
export const verifyApprovalToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET);
  } catch (error) {
    logger.error('Token verification failed:', error);
    return null;
  }
};

// Send approval request email to admin
export const sendApprovalEmail = async (userData) => {
  const { email, name } = userData;

  try {
    const emailTransporter = initializeTransporter();
    
    if (!emailTransporter) {
      logger.error('Email transporter not available. Check EMAIL_USER and EMAIL_PASS environment variables.');
      return false;
    }

    const approvalToken = generateApprovalToken({ email });
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    const approvalUrl = `${baseUrl}/auth/approve?token=${approvalToken}`;
    const denyUrl = `${baseUrl}/auth/deny?token=${approvalToken}`;
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@stormgate.com';

    logger.info(`Preparing approval email for ${email} to be sent to admin: ${adminEmail}`);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: 'New User Registration Approval Required - Storm Gate',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0;">Storm Gate</h1>
            <p style="color: #666; margin: 5px 0;">User Management System</p>
          </div>
          
          <h2 style="color: #333;">New User Registration Request</h2>
          <p>A new user has requested to join Storm Gate:</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <ul style="list-style: none; padding: 0;">
              <li style="margin: 8px 0;"><strong>Name:</strong> ${name}</li>
              <li style="margin: 8px 0;"><strong>Email:</strong> ${email}</li>
              <li style="margin: 8px 0;"><strong>Approval Token:</strong> <small style="font-family: monospace;">${approvalToken}</small></li>
            </ul>
          </div>
          
          <div style="margin: 30px 0; text-align: center;">
            <a href="${approvalUrl}" 
               style="background-color: #22c55e; color: white; padding: 12px 24px; text-decoration: none; margin-right: 10px; border-radius: 5px; display: inline-block;">
              Approve
            </a>
            <a href="${denyUrl}" 
               style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Deny
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px;">This approval link will expire in 24 hours.</p>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
            <p>Direct URLs for testing:</p>
            <p>Approve: ${approvalUrl}</p>
            <p>Deny: ${denyUrl}</p>
          </div>
        </div>
      `,
    };

    logger.info(`Sending email from ${process.env.EMAIL_USER} to ${adminEmail}`);
    const result = await emailTransporter.sendMail(mailOptions);
    logger.info(`Approval email sent successfully for user: ${email}. Message ID: ${result.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending approval email:', error);
    logger.error('Error details:', {
      user: process.env.EMAIL_USER ? 'Set' : 'Not set',
      pass: process.env.EMAIL_PASS ? 'Set' : 'Not set',
      adminEmail: process.env.ADMIN_EMAIL || 'Using default',
      error: error.message
    });
    return false;
  }
};

// Send account approved notification to user
export const sendAccountApprovedEmail = async (userData) => {
  const { email, name } = userData;
  
  try {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Storm Gate Account Has Been Approved',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0;">Storm Gate</h1>
            <p style="color: #666; margin: 5px 0;">User Management System</p>
          </div>
          
          <h2 style="color: #22c55e;">Account Approved</h2>
          <p>Dear ${name},</p>
          <p>Your account at Storm Gate has been approved! You can now sign in to access your dashboard.</p>
          
          <div style="margin: 30px 0; text-align: center;">
            <a href="${baseUrl}/login" 
               style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Sign In Now
            </a>
          </div>
          
          <p>Welcome aboard!</p>
          
          <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
            <p>Storm Gate - User Management System</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Account approval notification sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error('Error sending account approval notification:', error);
    return false;
  }
};

// Send account denied notification to user
export const sendAccountDeniedEmail = async (userData) => {
  const { email, name } = userData;
  
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Storm Gate Account Registration Status',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0;">Storm Gate</h1>
            <p style="color: #666; margin: 5px 0;">User Management System</p>
          </div>
          
          <h2 style="color: #ef4444;">Account Registration Update</h2>
          <p>Dear ${name},</p>
          <p>We regret to inform you that your account registration at Storm Gate has been denied.</p>
          <p>If you believe this was done in error or would like to discuss this further, please contact our support team.</p>
          
          <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
            <p>For support, please contact: <a href="mailto:${process.env.ADMIN_EMAIL || 'admin@stormgate.com'}">${process.env.ADMIN_EMAIL || 'admin@stormgate.com'}</a></p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Account denial notification sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error('Error sending account denial notification:', error);
    return false;
  }
};

// Send registration confirmation to user (for pending approval)
export const sendRegistrationPendingEmail = async (userData) => {
  const { email, name } = userData;
  
  try {
    const emailTransporter = initializeTransporter();
    
    if (!emailTransporter) {
      logger.error('Email transporter not available. Check EMAIL_USER and EMAIL_PASS environment variables.');
      return false;
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Storm Gate Registration Received - Pending Approval',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0;">Storm Gate</h1>
            <p style="color: #666; margin: 5px 0;">User Management System</p>
          </div>
          
          <h2 style="color: #f59e0b;">Registration Received</h2>
          <p>Dear ${name},</p>
          <p>Thank you for registering with Storm Gate. Your registration has been received and is currently pending approval.</p>
          <p>You will receive an email notification once your account has been reviewed and approved by our administrators.</p>
          
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #92400e;"><strong>Next Steps:</strong></p>
            <p style="margin: 5px 0 0 0; color: #92400e;">Please wait for approval. This process typically takes 1-2 business days.</p>
          </div>
          
          <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 14px;">
            <p>For questions, please contact: <a href="mailto:${process.env.ADMIN_EMAIL || 'admin@stormgate.com'}">${process.env.ADMIN_EMAIL || 'admin@stormgate.com'}</a></p>
          </div>
        </div>
      `,
    };

    const result = await emailTransporter.sendMail(mailOptions);
    logger.info(`Registration pending notification sent to: ${email}. Message ID: ${result.messageId}`);
    return true;
  } catch (error) {
    logger.error('Error sending registration pending notification:', error);
    return false;
  }
};

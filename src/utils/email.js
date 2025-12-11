import jwt from 'jsonwebtoken';
import Logger from './logger-lambda.js';
import emailDelegate from '../emailIntegrator/deletage.js';

const logger = new Logger('email');

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
    const approvalToken = generateApprovalToken({ email });
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    const approvalUrl = `${baseUrl}/auth/approve?token=${approvalToken}`;
    const denyUrl = `${baseUrl}/auth/deny?token=${approvalToken}`;
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@stormgate.com';

    logger.info(`Preparing approval email for ${email} to be sent to admin: ${adminEmail}`);

    logger.info(`Sending email from ${process.env.EMAIL_USER} to ${adminEmail}`);
    const result = await emailDelegate.sendApprovalRequest({
      email: email,
      name: name,
      appName: 'Storm Gate',
      appDisplayName: 'User Management System',
      approvalUrl,
      denyUrl,
    });
    
    if (result.success) {
      logger.info(`Approval email sent successfully for user: ${email}. Message ID: ${result.messageId}`);
      return true;
    } else {
      throw new Error(`Email delegate failed: ${result.error}`);
    }
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
    
    const result = await emailDelegate.sendAccountApproved({
      email,
      name,
      loginUrl: `${baseUrl}/login`,
      appName: 'Storm Gate',
      appDisplayName: 'User Management System',
    });
    
    if (result.success) {
      logger.info(`Account approval notification sent to: ${email}`);
      return true;
    } else {
      throw new Error(`Email delegate failed: ${result.error}`);
    }
  } catch (error) {
    logger.error('Error sending account approval notification:', error);
    return false;
  }
};

// Send account denied notification to user
export const sendAccountDeniedEmail = async (userData) => {
  const { email, name } = userData;
  try {
    const result = await emailDelegate.sendAccountDenied({
      email,
      name,
      appName: 'Storm Gate',
      appDisplayName: 'User Management System',
    });
    
    if (result.success) {
      logger.info(`Account denial notification sent to: ${email}`);
      return true;
    } else {
      throw new Error(`Email delegate failed: ${result.error}`);
    }
  } catch (error) {
    logger.error('Error sending account denial notification:', error);
    return false;
  }
};

// Send registration confirmation to user (for pending approval)
export const sendRegistrationPendingEmail = async (userData) => {
  const { email, name } = userData;
  
  try {
    const result = await emailDelegate.sendRegistrationPending({
      email,
      name,
      appName: 'Storm Gate',
      appDisplayName: 'User Management System',
    });
    
    if (result.success) {
      logger.info(`Registration pending notification sent to: ${email}. Message ID: ${result.messageId}`);
      return true;
    } else {
      throw new Error(`Email delegate failed: ${result.error}`);
    }
  } catch (error) {
    logger.error('Error sending registration pending notification:', error);
    return false;
  }
};

// Send password reset email to user
export const sendPasswordResetEmail = async (userData) => {
  const { email, name, resetToken } = userData;
  
  try {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    const resetUrl = `${baseUrl}/reset-password/${resetToken}`;
    
    const result = await emailDelegate.sendPasswordReset({
      email,
      name,
      resetUrl,
      appName: 'Storm Gate',
      appDisplayName: 'User Management System',
    });
    
    if (result.success) {
      logger.info(`Password reset email sent to: ${email}. Message ID: ${result.messageId}`);
      return true;
    } else {
      throw new Error(`Email delegate failed: ${result.error}`);
    }
  } catch (error) {
    logger.error('Error sending password reset email:', error);
    return false;
  }
};

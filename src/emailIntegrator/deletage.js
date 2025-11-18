import axios from 'axios';
import Logger from '../utils/logger-lambda.js';

const logger = new Logger('email-delegate');

/**
 * Email Integrator Delegate
 * Handles unified email template sending with the new email system
 */
class EmailDelegate {

  async sendEmail(emailData) {
    try {
      const response = await axios.post(`${EMAIL_INTEGRATOR_BASE_URL}/auth/send-email`, emailData);
      
      // Return success result with proper structure
      return {
        success: true,
        messageId: response.data?.messageId || 'email-sent',
        templateType: emailData.templateType,
        recipient: emailData.email
      };
    } catch (error) {
      logger.error('Email delegate error:', error);
      return {
        success: false,
        error: error.message,
        templateType: emailData.templateType
      };
    }
  }
  
  /**
   * Send email using unified endpoint approach
   * @param {Object} emailData - Email data object
   * @param {string} emailData.email - Recipient email address
   * @param {string} emailData.name - Recipient name
   * @param {string} emailData.templateType - Template type (approval, approved, denied, pending)
   * @param {string} [emailData.appName] - Application name (optional)
   * @param {string} [emailData.appDisplayName] - Application display name (optional)
   * @returns {Promise<Object>} Result object with success status and details
   */
  async sendTemplateEmail(emailData) {
    try {
      logger.info(`Email delegate sending ${emailData.templateType} email to ${emailData.email}`);
      
      // Validate required fields
      if (!emailData.email || !emailData.name || !emailData.templateType) {
        throw new Error('Email, name, and templateType are required');
      }

      // Call the unified email function
      const result = await this.sendEmail(emailData);
      
      if (result.success) {
        logger.info(`Email delegate successfully sent ${emailData.templateType} email`, {
          templateType: result.templateType,
          recipient: result.recipient,
          messageId: result.messageId
        });
      } else {
        logger.error(`Email delegate failed to send ${emailData.templateType} email`, {
          error: result.error,
          templateType: result.templateType
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Email delegate error:', error);
      return {
        success: false,
        error: error.message,
        templateType: emailData.templateType
      };
    }
  }

  /**
   * Send approval request email to admin
   * @param {Object} userData - User data object
   * @param {string} userData.email - User email
   * @param {string} userData.name - User name
   * @param {string} [userData.appName] - Application name
   * @param {string} [userData.appDisplayName] - Application display name
   * @param {string} [userData.approvalUrl] - Approval URL
   * @param {string} [userData.denyUrl] - Deny URL
   * @returns {Promise<Object>} Result object
   */
  async sendApprovalRequest(userData) {
    return await this.sendTemplateEmail({
      ...userData,
      templateType: 'approval'
    });
  }

  /**
   * Send account approved notification to user
   * @param {Object} userData - User data object
   * @param {string} userData.email - User email
   * @param {string} userData.name - User name
   * @param {string} [userData.appName] - Application name
   * @param {string} [userData.appDisplayName] - Application display name
   * @param {string} [userData.loginUrl] - Login URL
   * @returns {Promise<Object>} Result object
   */
  async sendAccountApproved(userData) {
    return await this.sendTemplateEmail({
      ...userData,
      templateType: 'approved'
    });
  }

  /**
   * Send account denied notification to user
   * @param {Object} userData - User data object
   * @param {string} userData.email - User email
   * @param {string} userData.name - User name
   * @param {string} [userData.appName] - Application name
   * @param {string} [userData.appDisplayName] - Application display name
   * @returns {Promise<Object>} Result object
   */
  async sendAccountDenied(userData) {
    return await this.sendTemplateEmail({
      ...userData,
      templateType: 'denied'
    });
  }

  /**
   * Send registration pending notification to user
   * @param {Object} userData - User data object
   * @param {string} userData.email - User email
   * @param {string} userData.name - User name
   * @param {string} [userData.appName] - Application name
   * @param {string} [userData.appDisplayName] - Application display name
   * @returns {Promise<Object>} Result object
   */
  async sendRegistrationPending(userData) {
    return await this.sendTemplateEmail({
      ...userData,
      templateType: 'pending'
    });
  }

  /**
   * Get template configuration information
   * @returns {Object} Template configuration details
   */
  getTemplateInfo() {
    return {
      availableTemplates: [
        {
          type: 'approval',
          description: 'Admin approval request email',
          recipient: 'Admin',
          purpose: 'Notify admin of new user registration requiring approval'
        },
        {
          type: 'approved',
          description: 'Account approved notification',
          recipient: 'User',
          purpose: 'Notify user that their account has been approved'
        },
        {
          type: 'denied',
          description: 'Account denied notification',
          recipient: 'User',
          purpose: 'Notify user that their account registration was denied'
        },
        {
          type: 'pending',
          description: 'Registration pending confirmation',
          recipient: 'User',
          purpose: 'Confirm user registration is received and pending approval'
        }
      ],
      requiredFields: ['email', 'name', 'templateType'],
      optionalFields: ['appName', 'appDisplayName'],
      endpoint: '/auth/send-email'
    };
  }
}

// Export singleton instance
const emailDelegate = new EmailDelegate();
export default emailDelegate;

// Named exports for convenience
export const {
  sendTemplateEmail,
  sendApprovalRequest,
  sendAccountApproved,
  sendAccountDenied,
  sendRegistrationPending,
  getTemplateInfo
} = emailDelegate;

const EMAIL_INTEGRATOR_BASE_URL =
  process.env.NODE_ENV === 'production'
    ? 'http://email-integrator-prod.eba-p4bnt2xm.us-east-1.elasticbeanstalk.com'
    : 'http://localhost:8080';
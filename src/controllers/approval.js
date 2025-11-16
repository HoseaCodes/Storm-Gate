import User from "../models/user.js";
import { verifyApprovalToken, sendAccountApprovedEmail, sendAccountDeniedEmail, sendApprovalEmail } from "../utils/email.js";
import Logger from "../utils/logger-lambda.js";

const logger = new Logger("approval");

/**
 * Approve user account
 * GET /auth/approve?token=...
 */
async function approveUser(req, res) {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const userData = verifyApprovalToken(token);
    if (!userData) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const userEmail = typeof userData === 'string' ? userData : userData.email;
    if (!userEmail) {
      throw new Error('Invalid token data');
    }

    // Update user status to approved
    const user = await User.findOneAndUpdate(
      { email: userEmail },
      { status: 'APPROVED' },
      { new: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    // Send approval notification to user
    await sendAccountApprovedEmail({
      email: user.email,
      name: user.name
    });

    logger.info(`User approved: ${user.email}`);

    // Return success response (you might want to redirect to a success page instead)
    res.status(200).json({
      success: true,
      message: 'User account has been approved successfully',
      user: {
        email: user.email,
        name: user.name,
        status: user.status
      }
    });

  } catch (error) {
    logger.error('Error in approval route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Deny user account
 * GET /auth/deny?token=...
 */
async function denyUser(req, res) {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const userData = verifyApprovalToken(token);
    if (!userData) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const userEmail = typeof userData === 'string' ? userData : userData.email;
    if (!userEmail) {
      throw new Error('Invalid token data');
    }

    // Find user before deletion
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      throw new Error('User not found');
    }

    // Send denial notification
    await sendAccountDeniedEmail({
      email: user.email,
      name: user.name
    });

    // Update user status to denied (alternatively, you could delete the user)
    await User.findOneAndUpdate(
      { email: userEmail },
      { status: 'DENIED' }
    );

    logger.info(`User denied: ${user.email}`);

    // Return success response
    res.status(200).json({
      success: true,
      message: 'User account has been denied',
      user: {
        email: user.email,
        name: user.name,
        status: 'DENIED'
      }
    });

  } catch (error) {
    logger.error('Error in deny route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get pending users (for admin dashboard)
 * GET /auth/pending-users
 */
async function getPendingUsers(req, res) {
  try {
    const pendingUsers = await User.find({ status: 'PENDING' })
      .select('name email createdAt application')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: pendingUsers.length,
      users: pendingUsers
    });

  } catch (error) {
    logger.error('Error fetching pending users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Manually approve user by admin
 * POST /auth/manual-approve
 */
async function manuallyApproveUser(req, res) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { status: 'APPROVED' },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send approval notification to user
    await sendAccountApprovedEmail({
      email: user.email,
      name: user.name
    });

    logger.info(`User manually approved: ${user.email}`);

    res.json({
      success: true,
      message: 'User approved successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        status: user.status
      }
    });

  } catch (error) {
    logger.error('Error in manual approval:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Manually deny user by admin
 * POST /auth/manual-deny
 */
async function manuallyDenyUser(req, res) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send denial notification
    await sendAccountDeniedEmail({
      email: user.email,
      name: user.name
    });

    // Update status to denied
    user.status = 'DENIED';
    await user.save();

    logger.info(`User manually denied: ${user.email}`);

    res.json({
      success: true,
      message: 'User denied successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        status: user.status
      }
    });

  } catch (error) {
    logger.error('Error in manual denial:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Test email functionality
 * POST /auth/test-email
 */
async function testEmail(req, res) {
  try {
    const { email, name } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    // Test sending approval email
    logger.info(`Testing email functionality for: ${email}`);
    const emailSent = await sendApprovalEmail({ email, name });

    if (emailSent) {
      res.json({
        success: true,
        message: `Test approval email sent successfully to ${process.env.ADMIN_EMAIL || 'admin@stormgate.com'}`,
        emailConfig: {
          fromEmail: process.env.EMAIL_USER ? 'Configured' : 'Not configured',
          password: process.env.EMAIL_PASS ? 'Configured' : 'Not configured',
          adminEmail: process.env.ADMIN_EMAIL || 'Using default: admin@stormgate.com',
          baseUrl: process.env.BASE_URL || 'Using default: http://localhost:3001'
        }
      });
    } else {
      res.status(400).json({
        error: 'Failed to send email',
        message: 'Check server logs for detailed error information',
        emailConfig: {
          fromEmail: process.env.EMAIL_USER ? 'Configured' : 'Not configured',
          password: process.env.EMAIL_PASS ? 'Configured' : 'Not configured',
          adminEmail: process.env.ADMIN_EMAIL || 'Using default: admin@stormgate.com',
          baseUrl: process.env.BASE_URL || 'Using default: http://localhost:3001'
        }
      });
    }

  } catch (error) {
    logger.error('Error in email test:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

const approvalController = {
  approveUser,
  denyUser,
  getPendingUsers,
  manuallyApproveUser,
  manuallyDenyUser,
  testEmail
};

export default approvalController;

import jwt from 'jsonwebtoken';
import UnregisteredUser from '../models/unregisteredUser.js';

export const guestLogin = async (req, res) => {
  try {
    // Extract device and browser info from headers
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const deviceInfo = req.headers['sec-ch-ua-platform'] || 'Unknown';

    // Create a guest user object with device/browser info
    const guestUserData = {
      name: 'Guest',
      bio: '',
      images: '',
      userAgent,
      deviceInfo,
      createdAt: new Date(),
    };

    // Save guest user to DB
    const guestUser = await UnregisteredUser.create(guestUserData);

    // Generate access token for guest
    const accessToken = jwt.sign(
      { id: guestUser._id, isGuest: true },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({
      accessToken,
      user: {
        id: guestUser._id,
        name: guestUser.name,
        isGuest: true,
        userAgent: guestUser.userAgent,
        deviceInfo: guestUser.deviceInfo,
        createdAt: guestUser.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Guest login failed' });
  }
};

// Get guest user by id
export const getGuestUser = async (req, res) => {
  try {
    const { id } = req.params;
    const guestUser = await UnregisteredUser.findById(id);
    if (!guestUser) {
      return res.status(404).json({ error: 'Guest user not found' });
    }
    res.status(200).json({
      id: guestUser._id,
      name: guestUser.name,
      isGuest: true,
      userAgent: guestUser.userAgent,
      deviceInfo: guestUser.deviceInfo,
      createdAt: guestUser.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch guest user' });
  }
};

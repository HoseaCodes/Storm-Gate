# Authentication Endpoints Consumption Guide

This guide provides detailed examples for consuming the authentication endpoints in a React application.

## Table of Contents
- [Setup](#setup)
- [Endpoints Overview](#endpoints-overview)
- [React Implementation Examples](#react-implementation-examples)
- [API Service](#api-service)
- [React Hooks](#react-hooks)
- [Components](#components)
- [Error Handling](#error-handling)

---

## Setup

### Environment Variables

Create a `.env` file in your React project:

```bash
REACT_APP_API_BASE_URL=http://localhost:8080
# or your production URL
# REACT_APP_API_BASE_URL='https://3ynqb3302m.execute-api.us-east-1.amazonaws.com'
```

---

## Endpoints Overview

| Endpoint | Method | Auth Required | Description |
|----------|--------|---------------|-------------|
| `/register` | POST | No | Register a new user account |
| `/login` | POST | No | Login with email and password |
| `/check-status` | POST | No | Check user registration status |
| `/forgot-password` | POST | No | Request password reset email |
| `/verify-reset-token` | POST | No | Verify password reset token validity |
| `/reset-password` | POST | No | Reset password with token |
| `/me` | GET | Yes | Get current user profile |

---

## React Implementation Examples

### 1. API Service Layer

Create `src/services/authService.js`:

```javascript
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8080';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

const authService = {
  /**
   * Register a new user
   * @param {Object} userData - User registration data
   * @param {string} userData.name - User's full name
   * @param {string} userData.email - User's email address
   * @param {string} userData.username - Optional username
   * @param {string} userData.password - User's password (min 6 characters)
   * @param {string} userData.role - Optional role (default: "basic")
   * @param {string} userData.application - Optional application type ("blog", etc.)
   * @param {string} userData.status - Optional status ("PENDING" or "APPROVED")
   * @returns {Promise} Response with accesstoken or pending status
   */
  register: async (userData) => {
    const response = await api.post('/register', userData);
    
    // If approved, store token
    if (response.data.accesstoken) {
      localStorage.setItem('accessToken', response.data.accesstoken);
    }
    
    return response.data;
  },

  /**
   * Login user
   * @param {Object} credentials - Login credentials
   * @param {string} credentials.email - User's email
   * @param {string} credentials.password - User's password
   * @param {boolean} credentials.rememberMe - Remember user session
   * @returns {Promise} Response with accesstoken
   */
  login: async (credentials) => {
    const response = await api.post('/login', credentials);
    
    if (response.data.accesstoken) {
      localStorage.setItem('accessToken', response.data.accesstoken);
    }
    
    return response.data;
  },

  /**
   * Check user registration status
   * @param {string} email - User's email to check
   * @returns {Promise} User status information
   */
  checkStatus: async (email) => {
    const response = await api.post('/check-status', { email });
    return response.data;
  },

  /**
   * Request password reset
   * @param {string} email - User's email
   * @returns {Promise} Success message
   */
  forgotPassword: async (email) => {
    const response = await api.post('/forgot-password', { email });
    return response.data;
  },

  /**
   * Verify password reset token
   * @param {string} token - Reset token from email
   * @returns {Promise} Token validity status
   */
  verifyResetToken: async (token) => {
    const response = await api.post('/verify-reset-token', { token });
    return response.data;
  },

  /**
   * Reset password with token
   * @param {string} token - Reset token from email
   * @param {string} password - New password (min 6 characters)
   * @returns {Promise} Success message
   */
  resetPassword: async (token, password) => {
    const response = await api.post('/reset-password', { token, password });
    return response.data;
  },

  /**
   * Get current user profile
   * @returns {Promise} Current user data
   */
  getMe: async () => {
    const response = await api.get('/me');
    return response.data;
  },

  /**
   * Logout user
   */
  logout: () => {
    localStorage.removeItem('accessToken');
    window.location.href = '/login';
  },
};

export default authService;
```

---

### 2. React Context for Auth State

Create `src/context/AuthContext.js`:

```javascript
import React, { createContext, useContext, useState, useEffect } from 'react';
import authService from '../services/authService';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if user is logged in on mount
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        try {
          const userData = await authService.getMe();
          setUser(userData.user);
        } catch (err) {
          localStorage.removeItem('accessToken');
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const register = async (userData) => {
    try {
      setError(null);
      const data = await authService.register(userData);
      
      if (data.requiresApproval) {
        return { success: true, requiresApproval: true, message: data.msg };
      }
      
      if (data.accesstoken) {
        const userData = await authService.getMe();
        setUser(userData.user);
        return { success: true, requiresApproval: false };
      }
    } catch (err) {
      setError(err.response?.data?.msg || 'Registration failed');
      throw err;
    }
  };

  const login = async (credentials) => {
    try {
      setError(null);
      const data = await authService.login(credentials);
      
      if (data.limitedAccess) {
        setUser({ ...data, status: 'PENDING' });
        return { success: true, limitedAccess: true, message: data.msg };
      }
      
      const userData = await authService.getMe();
      setUser(userData.user);
      return { success: true };
    } catch (err) {
      setError(err.response?.data?.msg || 'Login failed');
      throw err;
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
  };

  const value = {
    user,
    loading,
    error,
    register,
    login,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
```

---

### 3. Registration Component

Create `src/components/Register.jsx`:

```javascript
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Register = () => {
  const navigate = useNavigate();
  const { register } = useAuth();
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    role: 'basic',
  });
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setLoading(true);

    try {
      const result = await register({
        name: formData.name,
        email: formData.email,
        username: formData.username || undefined,
        password: formData.password,
        role: formData.role,
      });

      if (result.requiresApproval) {
        setSuccess(result.message || 'Registration successful! Your account is pending approval.');
        setTimeout(() => navigate('/login'), 3000);
      } else {
        setSuccess('Registration successful! Redirecting...');
        setTimeout(() => navigate('/dashboard'), 1500);
      }
    } catch (err) {
      setError(err.response?.data?.msg || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-container">
      <h2>Create Account</h2>
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Full Name *</label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="email">Email *</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="username">Username (Optional)</label>
          <input
            type="text"
            id="username"
            name="username"
            value={formData.username}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password *</label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            minLength={6}
          />
          <small>Minimum 6 characters</small>
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm Password *</label>
          <input
            type="password"
            id="confirmPassword"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            required
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Creating Account...' : 'Register'}
        </button>
      </form>

      <p>
        Already have an account? <Link to="/login">Login here</Link>
      </p>
    </div>
  );
};

export default Register;
```

---

### 4. Login Component

Create `src/components/Login.jsx`:

```javascript
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  });
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setFormData({
      ...formData,
      [e.target.name]: value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(formData);

      if (result.limitedAccess) {
        setError(result.message || 'Your account is pending approval. Limited access granted.');
        // Optionally redirect to a limited dashboard
        setTimeout(() => navigate('/pending-approval'), 2000);
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.msg || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <h2>Login</h2>
      
      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group checkbox">
          <label>
            <input
              type="checkbox"
              name="rememberMe"
              checked={formData.rememberMe}
              onChange={handleChange}
            />
            Remember me
          </label>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>

      <div className="links">
        <Link to="/forgot-password">Forgot password?</Link>
        <span>•</span>
        <Link to="/register">Create account</Link>
      </div>
    </div>
  );
};

export default Login;
```

---

### 5. Check Status Component

Create `src/components/CheckStatus.jsx`:

```javascript
import React, { useState } from 'react';
import authService from '../services/authService';

const CheckStatus = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus(null);
    setLoading(true);

    try {
      const data = await authService.checkStatus(email);
      setStatus(data.user);
    } catch (err) {
      setError(err.response?.data?.msg || 'Failed to check status');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (userStatus) => {
    const badges = {
      APPROVED: { text: 'Approved', className: 'status-approved' },
      PENDING: { text: 'Pending Approval', className: 'status-pending' },
      DENIED: { text: 'Denied', className: 'status-denied' },
    };
    return badges[userStatus] || badges.APPROVED;
  };

  return (
    <div className="check-status-container">
      <h2>Check Registration Status</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email Address</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your registered email"
            required
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Checking...' : 'Check Status'}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {status && (
        <div className="status-result">
          <h3>Account Status</h3>
          <div className="status-info">
            <p><strong>Name:</strong> {status.name}</p>
            <p><strong>Email:</strong> {status.email}</p>
            <p>
              <strong>Status:</strong>{' '}
              <span className={getStatusBadge(status.status).className}>
                {getStatusBadge(status.status).text}
              </span>
            </p>
            <p><strong>Registered:</strong> {new Date(status.registeredAt).toLocaleDateString()}</p>
          </div>
          
          {status.status === 'PENDING' && (
            <div className="status-message">
              Your account is pending administrator approval. You'll receive an email once approved.
            </div>
          )}
          
          {status.status === 'DENIED' && (
            <div className="status-message error">
              Your registration was denied. Please contact support for more information.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CheckStatus;
```

---

### 6. Forgot Password Component

Create `src/components/ForgotPassword.jsx`:

```javascript
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import authService from '../services/authService';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const data = await authService.forgotPassword(email);
      setSuccess(data.msg);
      setEmail(''); // Clear form
    } catch (err) {
      setError(err.response?.data?.msg || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-password-container">
      <h2>Reset Password</h2>
      <p>Enter your email address and we'll send you a link to reset your password.</p>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email Address</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Sending...' : 'Send Reset Link'}
        </button>
      </form>

      <div className="links">
        <Link to="/login">Back to Login</Link>
      </div>
    </div>
  );
};

export default ForgotPassword;
```

---

### 7. Reset Password Component

Create `src/components/ResetPassword.jsx`:

```javascript
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import authService from '../services/authService';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });
  
  const [tokenValid, setTokenValid] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setError('Invalid reset link');
        setVerifying(false);
        return;
      }

      try {
        await authService.verifyResetToken(token);
        setTokenValid(true);
      } catch (err) {
        setError(err.response?.data?.msg || 'Invalid or expired reset link');
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setLoading(true);

    try {
      const data = await authService.resetPassword(token, formData.password);
      setSuccess(data.msg);
      
      // Redirect to login after 3 seconds
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.msg || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div className="reset-password-container">
        <p>Verifying reset link...</p>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="reset-password-container">
        <h2>Invalid Link</h2>
        <div className="error-message">{error}</div>
        <div className="links">
          <Link to="/forgot-password">Request new reset link</Link>
          <span>•</span>
          <Link to="/login">Back to Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-password-container">
      <h2>Set New Password</h2>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="password">New Password</label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            minLength={6}
          />
          <small>Minimum 6 characters</small>
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm New Password</label>
          <input
            type="password"
            id="confirmPassword"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            required
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>
      </form>
    </div>
  );
};

export default ResetPassword;
```

---

### 8. Profile Component (Using /me endpoint)

Create `src/components/Profile.jsx`:

```javascript
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import authService from '../services/authService';

const Profile = () => {
  const { user: contextUser, logout } = useAuth();
  const [user, setUser] = useState(contextUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshProfile = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await authService.getMe();
      setUser(data.user);
    } catch (err) {
      setError(err.response?.data?.msg || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshProfile();
  }, []);

  const getStatusBadge = (status) => {
    const badges = {
      APPROVED: { text: 'Active', className: 'badge-success' },
      PENDING: { text: 'Pending Approval', className: 'badge-warning' },
      DENIED: { text: 'Access Denied', className: 'badge-error' },
    };
    return badges[status] || badges.APPROVED;
  };

  if (loading) {
    return <div className="profile-container">Loading profile...</div>;
  }

  if (error) {
    return (
      <div className="profile-container">
        <div className="error-message">{error}</div>
        <button onClick={refreshProfile}>Retry</button>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <h2>My Profile</h2>
        <button onClick={logout} className="logout-button">
          Logout
        </button>
      </div>

      {user && (
        <div className="profile-content">
          <div className="profile-info">
            <div className="info-row">
              <span className="label">Name:</span>
              <span className="value">{user.name}</span>
            </div>
            
            <div className="info-row">
              <span className="label">Email:</span>
              <span className="value">{user.email}</span>
            </div>
            
            {user.username && (
              <div className="info-row">
                <span className="label">Username:</span>
                <span className="value">{user.username}</span>
              </div>
            )}
            
            <div className="info-row">
              <span className="label">Role:</span>
              <span className="value">{user.role}</span>
            </div>
            
            <div className="info-row">
              <span className="label">Status:</span>
              <span className={`badge ${getStatusBadge(user.status).className}`}>
                {getStatusBadge(user.status).text}
              </span>
            </div>
            
            <div className="info-row">
              <span className="label">Member Since:</span>
              <span className="value">
                {new Date(user.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </span>
            </div>
          </div>

          {user.status === 'PENDING' && (
            <div className="status-alert warning">
              Your account is pending administrator approval. Some features may be limited.
            </div>
          )}

          {user.status === 'DENIED' && (
            <div className="status-alert error">
              Your account access has been denied. Please contact support.
            </div>
          )}

          <button onClick={refreshProfile} className="refresh-button">
            Refresh Profile
          </button>
        </div>
      )}
    </div>
  );
};

export default Profile;
```

---

### 9. Protected Route Component

Create `src/components/ProtectedRoute.jsx`:

```javascript
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return isAuthenticated ? children : <Navigate to="/login" />;
};

export default ProtectedRoute;
```

---

### 10. App Setup

Create `src/App.jsx`:

```javascript
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Register from './components/Register';
import Login from './components/Login';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import CheckStatus from './components/CheckStatus';
import Profile from './components/Profile';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="app">
          <Routes>
            {/* Public routes */}
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/check-status" element={<CheckStatus />} />

            {/* Protected routes */}
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <div>Dashboard Content</div>
                </ProtectedRoute>
              }
            />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/login" />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

---

## Error Handling

### Common Error Responses

```javascript
// 400 - Bad Request
{
  "msg": "Email is required"
}

// 401 - Unauthorized
{
  "msg": "Invalid password"
}

// 403 - Forbidden
{
  "msg": "Your account registration has been denied. Please contact support.",
  "status": "DENIED"
}

// 404 - Not Found
{
  "msg": "User not found"
}

// 409 - Conflict
{
  "msg": "Email already exists"
}

// 500 - Server Error
{
  "msg": "Internal server error"
}
```

### Error Handling Hook

Create `src/hooks/useErrorHandler.js`:

```javascript
import { useState } from 'react';

export const useErrorHandler = () => {
  const [error, setError] = useState('');

  const handleError = (err) => {
    if (err.response) {
      // Server responded with error
      setError(err.response.data.msg || 'An error occurred');
    } else if (err.request) {
      // Request made but no response
      setError('Network error. Please check your connection.');
    } else {
      // Something else happened
      setError(err.message || 'An unexpected error occurred');
    }
  };

  const clearError = () => setError('');

  return { error, handleError, clearError };
};
```

---

## Additional Examples

### Using with React Query

```javascript
import { useMutation, useQuery } from '@tanstack/react-query';
import authService from '../services/authService';

// Login mutation
const useLogin = () => {
  return useMutation({
    mutationFn: (credentials) => authService.login(credentials),
    onSuccess: (data) => {
      // Handle success
      console.log('Login successful', data);
    },
    onError: (error) => {
      // Handle error
      console.error('Login failed', error);
    },
  });
};

// Get profile query
const useProfile = () => {
  return useQuery({
    queryKey: ['profile'],
    queryFn: authService.getMe,
    enabled: !!localStorage.getItem('accessToken'),
    retry: false,
  });
};
```

### Using with Zustand

```javascript
import { create } from 'zustand';
import authService from '../services/authService';

export const useAuthStore = create((set) => ({
  user: null,
  loading: false,
  error: null,
  
  login: async (credentials) => {
    set({ loading: true, error: null });
    try {
      const data = await authService.login(credentials);
      const userData = await authService.getMe();
      set({ user: userData.user, loading: false });
      return data;
    } catch (error) {
      set({ error: error.response?.data?.msg, loading: false });
      throw error;
    }
  },
  
  logout: () => {
    authService.logout();
    set({ user: null });
  },
  
  register: async (userData) => {
    set({ loading: true, error: null });
    try {
      const data = await authService.register(userData);
      set({ loading: false });
      return data;
    } catch (error) {
      set({ error: error.response?.data?.msg, loading: false });
      throw error;
    }
  },
}));
```

---

## Testing

### Jest Test Example

```javascript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Login from './components/Login';
import { AuthProvider } from './context/AuthContext';
import authService from './services/authService';

jest.mock('./services/authService');

describe('Login Component', () => {
  it('should login successfully', async () => {
    authService.login.mockResolvedValue({
      accesstoken: 'fake-token',
      status: 'Successful',
    });
    
    authService.getMe.mockResolvedValue({
      user: { id: '1', name: 'Test User', email: 'test@example.com' },
    });

    render(
      <BrowserRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </BrowserRouter>
    );

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(authService.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false,
      });
    });
  });
});
```

---

## Best Practices

1. **Always validate user input** before sending to API
2. **Store tokens securely** - use httpOnly cookies when possible
3. **Handle token expiration** gracefully with interceptors
4. **Provide clear feedback** for pending approvals and denied access
5. **Implement proper loading states** for better UX
6. **Use environment variables** for API URLs
7. **Implement rate limiting** on the client side
8. **Clear sensitive data** on logout
9. **Handle network errors** appropriately
10. **Test all authentication flows** thoroughly

---

## Security Considerations

- Never store passwords in state or localStorage
- Always use HTTPS in production
- Implement CSRF protection if using cookies
- Validate tokens on every protected request
- Implement proper session timeout
- Use secure password requirements (min 6 chars as per API)
- Consider implementing 2FA for additional security

---

## Support

For issues or questions, please refer to the main API documentation or contact the backend team.

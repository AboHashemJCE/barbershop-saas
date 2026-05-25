import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// ----------------------------
// MIDDLEWARE: authenticate
// Verifies JWT token from Authorization header
// Adds req.user to the request if valid
// ----------------------------
export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Token must be in format: "Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// ----------------------------
// MIDDLEWARE: requireRole
// Must be used after authenticate
// Checks req.user.role matches one of the allowed roles
// ----------------------------
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action' });
    }

    next();
  };
};

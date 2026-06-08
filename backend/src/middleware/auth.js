
import jwt from 'jsonwebtoken';

export function authenticate(req, res, next) {
  try {
    let token = null;

    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    
    if (token === 'undefined' || token === 'null' || (typeof token === 'string' && token.trim() === '')) {
      token = null;
    }

    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded; // { id, role, phone }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

export function requireAdmin(req, res, next) {
  const allowedAdminRoles = ['ADMIN', 'SUPER_ADMIN'];
  if (!req.user || !allowedAdminRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
}

export function requireSellerOrAdmin(req, res, next) {
  const allowedRoles = ['SELLER', 'FATTENER', 'TRADER', 'ADMIN', 'SUPER_ADMIN'];
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Seller or Admin privileges required.' });
  }
  next();
}

export function requireSeller(req, res, next) {
  const allowedRoles = ['SELLER', 'FATTENER', 'TRADER'];
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Seller privileges required.' });
  }
  next();
}


export function optionalAuth(req, res, next) {
  try {
    let token = null;

    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    
    if (token === 'undefined' || token === 'null' || (typeof token === 'string' && token.trim() === '')) {
      token = null;
    }

    if (token) {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }
  } catch {
    
  }
  next();
}


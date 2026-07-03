import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { prisma } from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
export const PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET || 'portal-super-secret-key';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; role: string };
  org?: { id: string; name: string; plan: string };
  environment?: string;
  portalSession?: { orgId: string; customerRef: string };
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(401).json({ error: 'API key is missing' });
  }

  // Strip "Bearer " if sent in Authorization header
  const cleanKey = apiKey.startsWith('Bearer ') ? apiKey.substring(7) : apiKey;
  const keyHash = hashApiKey(cleanKey);

  try {
    const keyRecord = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { organization: true }
    });

    if (!keyRecord || keyRecord.revokedAt) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    req.org = {
      id: keyRecord.orgId,
      name: keyRecord.organization.name,
      plan: keyRecord.organization.plan
    };
    req.environment = keyRecord.environment;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

export async function authenticateUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header is missing or malformed' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role: string;
      orgId: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { organization: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'User does not exist' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    req.org = {
      id: user.orgId,
      name: user.organization.name,
      plan: user.organization.plan
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

export async function authenticatePortalToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header is missing or malformed' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, PORTAL_JWT_SECRET) as {
      orgId: string;
      customerRef: string;
    };

    req.portalSession = {
      orgId: decoded.orgId,
      customerRef: decoded.customerRef
    };

    const org = await prisma.organization.findUnique({
      where: { id: decoded.orgId }
    });

    if (!org) {
      return res.status(401).json({ error: 'Organization does not exist' });
    }

    req.org = {
      id: org.id,
      name: org.name,
      plan: org.plan
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired portal token' });
  }
}

export function requirePlan(minTier: 'free' | 'starter' | 'growth' | 'business' | 'enterprise') {
  const tiers = ['free', 'starter', 'growth', 'business', 'enterprise'];
  const minIndex = tiers.indexOf(minTier);

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.org) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentIdx = tiers.indexOf(req.org.plan);
    if (currentIdx < minIndex) {
      return res.status(403).json({
        error: `This feature is locked. Upgrading to plan '${minTier}' or above is required. Current plan: '${req.org.plan}'`
      });
    }

    next();
  };
}

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { prisma } from '../db.js';
import { authenticateUser, JWT_SECRET, AuthenticatedRequest } from '../middleware/auth.js';
import { UserSignInSchema } from '@webhookengine/shared';

const router = Router();

// Sign up a new organization and user
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      // Create Organization
      const org = await tx.organization.create({
        data: {
          name,
          plan: 'free' // Initial free plan
        }
      });

      // Create User
      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email,
          passwordHash,
          role: 'admin'
        }
      });

      // Generate first API Key
      const rawKey = 'whkey_' + crypto.randomBytes(24).toString('hex');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      await tx.apiKey.create({
        data: {
          orgId: org.id,
          keyHash,
          environment: 'production'
        }
      });

      return { user, org, rawKey };
    });

    const token = jwt.sign(
      {
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        orgId: result.org.id
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      token,
      apiKey: result.rawKey,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role
      },
      organization: {
        id: result.org.id,
        name: result.org.name,
        plan: result.org.plan
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to complete signup' });
  }
});

// Sign in an existing user
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = UserSignInSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: true }
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        plan: user.organization.plan
      }
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'ZodError') {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get currently authenticated user details
router.get('/me', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    user: req.user,
    organization: req.org
  });
});

// List all API keys for an organization
router.get('/keys', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { orgId: req.org!.id },
      select: {
        id: true,
        environment: true,
        createdAt: true,
        revokedAt: true
      }
    });
    return res.json(keys);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve API keys' });
  }
});

// Create a new API key
router.post('/keys', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { environment } = req.body;
  const envValue = environment === 'development' ? 'development' : 'production';

  try {
    const rawKey = 'whkey_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const keyRecord = await prisma.apiKey.create({
      data: {
        orgId: req.org!.id,
        keyHash,
        environment: envValue
      }
    });

    return res.status(201).json({
      id: keyRecord.id,
      apiKey: rawKey,
      environment: keyRecord.environment,
      createdAt: keyRecord.createdAt
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// Revoke an API key
router.delete('/keys/:id', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const key = await prisma.apiKey.findFirst({
      where: { id, orgId: req.org!.id }
    });

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() }
    });

    return res.json({ message: 'API key successfully revoked' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;

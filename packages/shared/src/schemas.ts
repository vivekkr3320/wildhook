import { z } from 'zod';

export const EventIngestSchema = z.object({
  eventType: z.string().min(1, 'Event type is required'),
  payload: z.record(z.any()),
  idempotencyKey: z.string().optional()
});

export const EndpointCreateSchema = z.object({
  url: z.string().url('Must be a valid HTTP/HTTPS URL'),
  description: z.string().max(255).optional(),
  eventTypes: z.array(z.string()).min(1, 'Select at least one event type to subscribe to')
});

export const EndpointUpdateSchema = z.object({
  url: z.string().url('Must be a valid HTTP/HTTPS URL').optional(),
  description: z.string().max(255).optional(),
  eventTypes: z.array(z.string()).optional(),
  status: z.enum(['active', 'disabled']).optional()
});

export const OrgCreateSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters')
});

export const UserSignInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

export const PortalSessionSchema = z.object({
  customerRef: z.string().min(1, 'customerRef is required'),
  expiresInSeconds: z.number().int().min(60).max(86400).default(3600)
});

export const TransformationSchema = z.object({
  code: z.string().min(1, 'Transformation code is required'),
  language: z.enum(['javascript']).default('javascript'),
  enabled: z.boolean().default(true)
});

export const AlertConfigSchema = z.object({
  channel: z.enum(['email', 'slack']),
  target: z.string().min(1, 'Target destination is required (email address or Slack webhook URL)'),
  threshold: z.number().int().min(1).default(5),
  enabled: z.boolean().default(true)
});

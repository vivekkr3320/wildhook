import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import endpointRoutes from './routes/endpoints.js';
import portalRoutes from './routes/portal.js';
import billingRoutes from './routes/billing.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Public health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount routes
app.use('/v1/auth', authRoutes);
app.use('/v1', eventRoutes);
app.use('/v1', endpointRoutes);
app.use('/v1', portalRoutes);
app.use('/v1', billingRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

export const server = app.listen(PORT, () => {
  console.log(`🚀 WebhookEngine API Server running on port ${PORT}`);
});

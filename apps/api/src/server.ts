import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch { /* .env file not found, use system env */ }

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import documentsRouter from './routes/documents.js';
import jurisdictionsRouter from './routes/jurisdictions.js';

const app: ReturnType<typeof express> = express();

// SECURITY: Disable X-Powered-By header
app.disable('x-powered-by');

// SECURITY: Trust first proxy for correct IP detection (req.ip)
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// SECURITY: Helmet with strict CSP and security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

// SECURITY: Restrict CORS to known origins
app.use(
  cors({
    origin: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: 600,
  }),
);

// Body parsing with strict limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Request ID
app.use(requestIdMiddleware);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      module: 'http',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.requestId,
    };

    if (res.statusCode >= 400) {
      logger.warn(logData);
    } else {
      logger.info(logData);
    }
  });

  next();
});

// Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/jurisdictions', jurisdictionsRouter);

// Global error handler (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(env.PORT, () => {
  logger.info({
    module: 'server',
    message: `Lex Terrae API server listening on port ${env.PORT}`,
    environment: env.NODE_ENV,
  });
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info({ module: 'server', message: `Received ${signal}. Starting graceful shutdown...` });

  server.close(async () => {
    logger.info({ module: 'server', message: 'HTTP server closed' });

    try {
      await prisma.$disconnect();
      logger.info({ module: 'server', message: 'Database connection closed' });
    } catch (err) {
      logger.error({ module: 'server', message: 'Error disconnecting from database', error: err });
    }

    try {
      await redis.quit();
      logger.info({ module: 'server', message: 'Redis connection closed' });
    } catch (err) {
      logger.error({ module: 'server', message: 'Error disconnecting from Redis', error: err });
    }

    logger.info({ module: 'server', message: 'Graceful shutdown complete' });
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error({ module: 'server', message: 'Forced shutdown after timeout' });
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server };

// NOTE: .env loading happens in config/env.ts — ES module imports are hoisted, so it
// cannot be done at the top of this file.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import documentsRouter from './routes/documents.js';
import jurisdictionsRouter from './routes/jurisdictions.js';
import { retentionService } from './services/retention.service.js';

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
        imgSrc: ["'self'", 'data:'],
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

// SECURITY: Only allow credentialed cross-origin requests from configured web origins (CORS_ORIGIN).
// The web app normally calls the API same-origin (Vite proxy / reverse proxy), which needs no CORS.
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: 600,
  }),
);

// Request ID (before body parsing so parse errors are still correlated)
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

// Body parsing with strict limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/jurisdictions', jurisdictionsRouter);

// Unknown API routes return a JSON 404 instead of Express's HTML page
app.use(notFoundHandler);

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

server.on('error', (err: NodeJS.ErrnoException) => {
  const message =
    err.code === 'EADDRINUSE'
      ? `Port ${env.PORT} is already in use. Stop the other process or set PORT to a free port.`
      : `HTTP server error: ${err.message}`;
  logger.fatal({ module: 'server', message, error: { name: err.name, code: err.code } });
  process.exit(1);
});

// Surface startup dependency problems clearly (the server still starts; /api/health reports status)
prisma.$connect().catch((err: unknown) => {
  logger.error({
    module: 'server',
    message:
      'Could not connect to the database at startup. Check DATABASE_URL and that Postgres is running.',
    error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
  });
});
redis.connect().catch(() => {
  // Error already logged by the redis 'error' listener; ioredis keeps retrying in the background
});

// Permanently remove documents past their soft-delete retention period.
// First run shortly after startup, then every 6 hours; never keeps the process alive.
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
function runRetentionPurge() {
  retentionService.purgeExpiredDocuments().catch((err: unknown) => {
    logger.error({
      module: 'server',
      message: 'Retention purge failed',
      error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
    });
  });
}
const purgeTimers =
  env.NODE_ENV === 'test'
    ? []
    : [
        setTimeout(runRetentionPurge, 60_000).unref(),
        setInterval(runRetentionPurge, PURGE_INTERVAL_MS).unref(),
      ];

// Graceful shutdown
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  purgeTimers.forEach((timer) => clearTimeout(timer));
  logger.info({ module: 'server', message: `Received ${signal}. Starting graceful shutdown...` });

  // Force shutdown after 10 seconds (unref so it never keeps the process alive by itself)
  setTimeout(() => {
    logger.error({ module: 'server', message: 'Forced shutdown after timeout' });
    process.exit(1);
  }, 10_000).unref();

  // Close idle keep-alive sockets so server.close() is not held open by idle clients
  server.closeIdleConnections();

  server.close(async () => {
    logger.info({ module: 'server', message: 'HTTP server closed' });

    try {
      await prisma.$disconnect();
      logger.info({ module: 'server', message: 'Database connection closed' });
    } catch (err) {
      logger.error({ module: 'server', message: 'Error disconnecting from database', error: err });
    }

    try {
      if (redis.status === 'ready') await redis.quit();
      else redis.disconnect();
      logger.info({ module: 'server', message: 'Redis connection closed' });
    } catch (err) {
      logger.error({ module: 'server', message: 'Error disconnecting from Redis', error: err });
    }

    logger.info({ module: 'server', message: 'Graceful shutdown complete' });
    process.exit(0);
  });
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({
    module: 'server',
    message: 'Unhandled promise rejection',
    error:
      reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: reason.stack }
        : String(reason),
  });
});

export { app, server };

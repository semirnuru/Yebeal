
import logger from './logger.js';

const redisUrl = process.env.REDIS_URL;
let redisClient = null;
let redisEnabled = false;

if (redisUrl) {
  try {
    const { default: Redis } = await import('ioredis');
    logger.info(`🔌 Connecting to Redis at ${redisUrl}...`);
    
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          logger.warn('⚠️ Redis connection attempts exceeded threshold. Disabling Redis integration.');
          redisEnabled = false;
          return null; 
        }
        return Math.min(times * 100, 2000);
      }
    });

    redisClient.on('connect', () => {
      redisEnabled = true;
      logger.info('✅ Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      logger.error('❌ Redis Connection Error:', err);
      
      redisEnabled = false;
    });
  } catch (err) {
    logger.error('❌ Failed to initialize Redis client:', err);
    redisEnabled = false;
  }
} else {
  logger.info('ℹ️ Redis URL not specified. Falling back to local/in-memory services.');
}

export { redisClient, redisEnabled };
export default redisClient;

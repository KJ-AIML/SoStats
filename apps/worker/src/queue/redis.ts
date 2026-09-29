import IORedis from 'ioredis';

export function createRedisConnection() {
  return new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    db: Number.parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null,
  });
}

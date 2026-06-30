import { Queue } from "bullmq";

let queue: Queue | undefined;

function redisConnectionOptions() {
  const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    db: redisUrl.pathname.length > 1 ? Number(redisUrl.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export function getTranscodeQueue(): Queue {
  if (!queue) {
    queue = new Queue(process.env.QUEUE_NAME ?? "tvmix-video-transcoding", {
      connection: redisConnectionOptions(),
    });
  }

  return queue;
}

export async function closeTranscodeQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}

import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.routes.js";
import internalWebhookRoutes from "./routes/internal-webhook.routes.js";
import videoRoutes from "./routes/video.routes.js";
import liveChannelRoutes from "./routes/live-channel.routes.js";
import { prisma } from "./lib/prisma.js";
import { closeTranscodeQueue } from "./lib/transcodeQueue.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = (
  process.env.CORS_ORIGINS ??
  process.env.CORS_ALLOWED_ORIGINS ??
  "https://www.tvmix.it,https://tvmix.it"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Le richieste senza Origin (health check, reverse proxy, server-to-server)
      // restano consentite; i browser sono limitati ai domini TVMIX configurati.
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);
app.use(
  express.json({
    limit: "100kb",
    verify(req, _res, buf) {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);

app.use(
  "/api/v1/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Troppi tentativi. Riprova più tardi." },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "TVMIX-BACKEND" });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/videos", videoRoutes);
app.use("/api/v1/live-channels", liveChannelRoutes);
app.use("/internal", internalWebhookRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint non trovato" });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Errore interno del server",
    ...(process.env.NODE_ENV === "development" && {
      message: error instanceof Error ? error.message : String(error),
    }),
  });
};

app.use(errorHandler);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`TVMIX-BACKEND in ascolto sulla porta ${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} ricevuto: arresto in corso`);
  server.close(async () => {
    await closeTranscodeQueue();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export default app;

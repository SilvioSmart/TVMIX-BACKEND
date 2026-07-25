import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.routes.js";
import internalWebhookRoutes from "./routes/internal-webhook.routes.js";
import videoRoutes from "./routes/video.routes.js";
import liveChannelRoutes from "./routes/live-channel.routes.js";
import menuRoutes from "./routes/menu.routes.js";
import carouselRoutes from "./routes/carousel.routes.js";
import moduleRoutes from "./routes/modules.routes.js";
import newsRoutes from "./routes/news.routes.js";
import appearanceRoutes from "./routes/appearance.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { prisma } from "./lib/prisma.js";
import { closeTranscodeQueue } from "./lib/transcodeQueue.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const publicApiUrl = process.env.PUBLIC_API_URL ?? "https://api.tvmix.it";
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? process.env.CORS_ALLOWED_ORIGINS ?? "https://tvmix.it,https://www.tvmix.it")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Le richieste senza Origin (health check, reverse proxy, server-to-server)
      // restano consentite; i browser sono limitati alle origini configurate.
      callback(null, !origin || allowedOrigins.has(origin));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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

app.use(
  "/api/v1/admin",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Limite richieste amministrative superato" },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "TVMIX-BACKEND" });
});

app.get("/", (_req, res) => {
  res.json({
    service: "TVMIX-BACKEND",
    status: "ok",
    api: `${publicApiUrl}/api/v1`,
    health: `${publicApiUrl}/health`,
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/videos", videoRoutes);
app.use("/api/v1/live-channels", liveChannelRoutes);
app.use("/api/v1/menu", menuRoutes);
app.use("/api/v1/carousel", carouselRoutes);
app.use("/api/v1/modules", moduleRoutes);
app.use("/api/v1/news", newsRoutes);
app.use("/api/v1/appearance", appearanceRoutes);
app.use("/internal", internalWebhookRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint non trovato" });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;

  res.status(status).json({
    error: status < 500 ? "Richiesta non valida" : "Errore interno del server",
    ...(process.env.NODE_ENV === "development" && {
      message: error instanceof Error ? error.message : String(error),
    }),
  });
};

app.use(errorHandler);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`TVMIX-BACKEND in ascolto sulla porta ${port} (${publicApiUrl})`);
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

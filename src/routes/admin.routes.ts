import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import adminVideoRoutes from "./admin-video.routes.js";
import adminCategoryRoutes from "./admin-category.routes.js";
import adminLiveStreamRoutes from "./admin-live-stream.routes.js";
import adminUserRoutes from "./admin-user.routes.js";
import adminUploadRoutes from "./admin-upload.routes.js";
import adminCatalogRoutes from "./admin-catalog.routes.js";
import adminAppearanceRoutes from "./admin-appearance.routes.js";
import adminFrontendMenuRoutes from "./admin-frontend-menu.routes.js";
import adminCarouselRoutes from "./admin-carousel.routes.js";
import adminHomeModuleRoutes from "./admin-home-module.routes.js";
import adminEpgRoutes from "./admin-epg.routes.js";

const router = Router();

router.use(requireAuth);

router.get("/", requireRole("EDITOR", "ADMIN"), (_req, res) => {
  res.json({
    service: "TVMIX Admin API",
    role: res.locals.auth.role,
    resources: ["videos", "catalog", "categories", "live-streams", "appearance", "modules", "epg"],
    ...(res.locals.auth.role === "ADMIN" && { adminResources: ["users"] }),
  });
});

router.use("/videos", requireRole("EDITOR", "ADMIN"), adminVideoRoutes);
router.use("/uploads", requireRole("EDITOR", "ADMIN"), adminUploadRoutes);
router.use("/catalog", requireRole("EDITOR", "ADMIN"), adminCatalogRoutes);
router.use("/appearance", requireRole("EDITOR", "ADMIN"), adminAppearanceRoutes);
router.use("/appearance/modules", requireRole("EDITOR", "ADMIN"), adminHomeModuleRoutes);
router.use("/carousel", requireRole("EDITOR", "ADMIN"), adminCarouselRoutes);
router.use("/frontend-menu", requireRole("EDITOR", "ADMIN"), adminFrontendMenuRoutes);
router.use("/epg", requireRole("EDITOR", "ADMIN"), adminEpgRoutes);
router.use("/categories", requireRole("EDITOR", "ADMIN"), adminCategoryRoutes);
router.use("/live-streams", requireRole("EDITOR", "ADMIN"), adminLiveStreamRoutes);
router.use("/users", requireRole("ADMIN"), adminUserRoutes);

export default router;

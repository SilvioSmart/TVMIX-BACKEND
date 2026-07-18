import { Router } from "express";
import { requireAuth, requireRoleOrPermission } from "../middleware/auth.middleware.js";
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
import adminRouteConfigRoutes from "./admin-route-config.routes.js";

const router = Router();

router.use(requireAuth);

const canViewContent = requireRoleOrPermission(["EDITOR", "ADMIN"], ["CONTENT_VIEW", "CONTENT_MANAGE"]);
const canManageContent = requireRoleOrPermission(["EDITOR", "ADMIN"], ["CONTENT_MANAGE"]);
const canManageCatalog = requireRoleOrPermission(["EDITOR", "ADMIN"], ["CATALOG_MANAGE"]);
const canManageLive = requireRoleOrPermission(["EDITOR", "ADMIN"], ["LIVE_MANAGE"]);
const canManageAppearance = requireRoleOrPermission(["EDITOR", "ADMIN"], ["APPEARANCE_MANAGE"]);
const canManageUsers = requireRoleOrPermission(["ADMIN"], ["USERS_MANAGE"]);

router.get("/", requireRoleOrPermission(["EDITOR", "ADMIN"], ["CONTENT_VIEW", "CONTENT_MANAGE", "CATALOG_MANAGE", "LIVE_MANAGE", "APPEARANCE_MANAGE", "USERS_MANAGE", "SETTINGS_MANAGE"]), (_req, res) => {
  res.json({
    service: "TVMIX Admin API",
    role: res.locals.auth.role,
    resources: ["videos", "catalog", "categories", "live-streams", "appearance", "modules", "epg"],
    ...(res.locals.auth.role === "ADMIN" && { adminResources: ["users"] }),
  });
});

router.use("/videos", canViewContent, adminVideoRoutes);
router.use("/uploads", canManageContent, adminUploadRoutes);
router.use("/route-configs", canManageContent, adminRouteConfigRoutes);
router.use("/catalog", canManageCatalog, adminCatalogRoutes);
router.use("/appearance", canManageAppearance, adminAppearanceRoutes);
router.use("/appearance/modules", canManageAppearance, adminHomeModuleRoutes);
router.use("/carousel", canManageAppearance, adminCarouselRoutes);
router.use("/frontend-menu", canManageAppearance, adminFrontendMenuRoutes);
router.use("/epg", canManageLive, adminEpgRoutes);
router.use("/categories", canManageCatalog, adminCategoryRoutes);
router.use("/live-streams", canManageLive, adminLiveStreamRoutes);
router.use("/users", canManageUsers, adminUserRoutes);

export default router;

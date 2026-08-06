import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useWorkspace } from "../../lib/workspace";
import { moduleForPath } from "../shell/nav";

/**
 * Keeps the current route honest about the current business.
 *
 * Switching business in the topbar doesn't navigate, so without this you can
 * be sitting on /animals as a rental business — a screen whose module you
 * don't have, reading a farm you're not in. The rail already hides those
 * links; this stops the URL being a way around that.
 *
 * Deliberately does nothing while the workspace is still loading: modules is
 * `[]` until membership resolves, and gating on that would bounce every
 * route to home on a cold load.
 */
export function RequireModule() {
  const { modules, loading, business } = useWorkspace();
  const { pathname } = useLocation();

  if (loading || !business) return <Outlet />;

  const required = moduleForPath(pathname);
  if (required && !modules.includes(required)) return <Navigate to="/" replace />;

  return <Outlet />;
}

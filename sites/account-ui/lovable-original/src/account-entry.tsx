import React from "react";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { AccountShell } from "@/components/account/shell";
import { Overview } from "@/components/account/overview";
import { AccountDetails } from "@/components/account/details";
import { sections, type AccountPath } from "@/lib/account/model";
import { OfficialAccountSessionProvider } from "@/lib/account/official-session";
import "./styles.css";
import "./account-live.css";

// Build only the copied Lovable Account Center as a static React application.
// Original components remain unmodified; real account integration is a separate
// gated step before swapping /conta/ in production.
const root = createRootRoute({ component: () => <Outlet /> });
const summary = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => <AccountShell><Overview /></AccountShell>,
});
const details = sections.filter(s => s.path !== "/").map(s =>
  createRoute({
    getParentRoute: () => root,
    path: s.path.slice(1),
    component: () => <AccountShell><AccountDetails path={s.path as AccountPath} /></AccountShell>,
  })
);
const routeTree = root.addChildren([summary, ...details]);
const router = createRouter({ routeTree, basepath: "/conta", scrollRestoration: true });
createRoot(document.getElementById("root")!).render(
  <React.StrictMode><OfficialAccountSessionProvider><RouterProvider router={router} /></OfficialAccountSessionProvider></React.StrictMode>
);

/**
 * Entry point for the admin app, included from src/index.html.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./admin/AdminApp";

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <AdminApp />
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  createRoot(elem).render(app);
}

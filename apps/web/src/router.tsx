import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// No router context: Lobi has no query client and no RPC — pages talk to the
// lobby over its WebSocket protocol from client-side feature hooks.
export const getRouter = () => {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
  });
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

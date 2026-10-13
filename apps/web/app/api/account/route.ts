import { proxyJson } from "@/lib/proxy";

/** Espacio usado, plan e invitaciones de la persona con sesión. */
export const GET = (req: Request) => proxyJson(req, "/v1/me/account", "GET");

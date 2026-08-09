import type { SystemRole } from "@arutech/types";

/** Shape attached to `request.user` by JwtAuthGuard after verifying the access token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  systemRole: SystemRole;
}

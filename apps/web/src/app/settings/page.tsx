import { redirect } from "next/navigation";
import {
  backendRequest,
  type WorkspaceRecord,
} from "@/lib/sostats-api.server";

export default async function SettingsRedirectPage() {
  let workspaceSlug = "demo";

  try {
    const workspaces = await backendRequest<WorkspaceRecord[]>("/workspaces");
    if (workspaces[0]) workspaceSlug = workspaces[0].slug;
  } catch {
    // Keep the development-compatible fallback when workspace lookup is unavailable.
  }

  redirect(`/${workspaceSlug}/settings`);
}

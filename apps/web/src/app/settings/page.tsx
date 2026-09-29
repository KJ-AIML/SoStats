import { redirect } from "next/navigation";
import {
  backendRequest,
  type WorkspaceRecord,
} from "@/lib/sostats-api.server";

export default async function SettingsRedirectPage() {
  try {
    const workspaces = await backendRequest<WorkspaceRecord[]>("/workspaces");
    if (workspaces[0]) {
      redirect(`/${workspaces[0].slug}/settings`);
    }
  } catch {
    // Fall through to the workspace bootstrap/root surface.
  }

  redirect("/demo/settings");
}

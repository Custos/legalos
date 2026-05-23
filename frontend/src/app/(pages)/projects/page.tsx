import { redirect } from "next/navigation";

// /projects listing collapses into /matters under the new design. Per-project
// detail still lives at /projects/[id] (the Studio · Workspace drilldown).
export default function ProjectsListRedirect() {
    redirect("/matters");
}

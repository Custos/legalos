import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { createClient } from "@supabase/supabase-js";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../lib/documentVersions";
import { downloadFile, uploadFile, storageKey } from "../lib/storage";
import { docxToPdf, convertedPdfKey } from "../lib/convert";
import { checkProjectAccess } from "../lib/access";
import { singleFileUpload } from "../lib/upload";
import { PROJECT_TEMPLATES, getTemplate } from "../lib/projectTemplates";
import { maybeAutofillCounterparty } from "../lib/counterpartyExtraction";
import { maybeExtractContractFacts } from "../lib/contractFacts";
import { maybeAnalyzeIntake } from "../lib/intakeAnalysis";

export const projectsRouter = Router();
const ALLOWED_TYPES = new Set(["pdf", "docx", "doc"]);

// GET /projects
projectsRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const db = createServerSupabase();
  try {

  const { data: ownProjects, error: ownError } = await db
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (ownError) return void res.status(500).json({ detail: ownError.message });

  const { data: sharedProjects, error: sharedError } = userEmail
    ? await db
        .from("projects")
        .select("*")
        .contains("shared_with", JSON.stringify([userEmail]))
        .neq("user_id", userId)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (sharedError)
    return void res.status(500).json({ detail: sharedError.message });

  const projects = [...(ownProjects ?? []), ...(sharedProjects ?? [])].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const result = await Promise.all(
    projects.map(async (p) => {
      const [docs, chats, reviews] = await Promise.all([
        db
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("project_id", p.id),
        db
          .from("chats")
          .select("id", { count: "exact", head: true })
          .eq("project_id", p.id),
        db
          .from("tabular_reviews")
          .select("id", { count: "exact", head: true })
          .eq("project_id", p.id),
      ]);
      return {
        ...p,
        is_owner: p.user_id === userId,
        document_count: docs.count ?? 0,
        chat_count: chats.count ?? 0,
        review_count: reviews.count ?? 0,
      };
    }),
  );
  res.json(result);
  } catch (e) {
    console.error("[GET /projects] error:", e);
    res.status(500).json({ detail: (e as Error).message ?? "unknown" });
  }
});

// POST /projects
projectsRouter.post("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { name, cm_number, shared_with, template } = req.body as {
    name: string;
    cm_number?: string;
    shared_with?: string[];
    template?: string;
  };
  if (!name?.trim())
    return void res.status(400).json({ detail: "name is required" });

  const tmpl = template ? getTemplate(template) : null;
  if (template && !tmpl)
    return void res.status(400).json({ detail: `Unknown template: ${template}` });

  const db = createServerSupabase();
  const { data, error } = await db
    .from("projects")
    .insert({
      user_id: userId,
      name: name.trim(),
      cm_number: cm_number ?? null,
      shared_with: shared_with ?? [],
      template: tmpl?.slug ?? null,
      role: tmpl?.role ?? null,
    })
    .select("*")
    .single();
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(201).json({ ...data, documents: [] });
});

// GET /projects/templates — registry of available project templates.
// Returned to the frontend so the New Project modal can render the picker
// without duplicating the list client-side.
projectsRouter.get("/templates", requireAuth, async (_req, res) => {
  res.json(PROJECT_TEMPLATES);
});

// GET /projects/counterparties/:name/timeline
// Aggregates everything for a single counterparty: their projects, the
// executed documents in each, and the contract_facts rows tied to those
// docs — all ordered chronologically. Powers the per-counterparty detail
// page so you can see "Acme Inc." across every contract you have with
// them as one timeline.
projectsRouter.get(
  "/counterparties/:name/timeline",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string;
    const cpName = decodeURIComponent(req.params.name).trim();
    if (!cpName)
      return void res.status(400).json({ detail: "name required" });
    const key = cpName.toLowerCase();

    const db = createServerSupabase();
    const { data: allProjects } = await db
      .from("projects")
      .select(
        "id, name, counterparty, parent_counterparty, role, template, created_at, updated_at, user_id, shared_with",
      );
    const accessibleProjects = (allProjects ?? []).filter((p) => {
      if (p.user_id === userId) return true;
      if (
        userEmail &&
        Array.isArray(p.shared_with) &&
        p.shared_with.includes(userEmail)
      )
        return true;
      return false;
    });
    // Find every accessible project that "involves" this counterparty —
    // either projects.counterparty matches, or any document in the project
    // has intake_counterparty matching. Lets multi-counterparty projects
    // ("Customer Contracts" bucket) appear under each customer.
    const accessibleProjectIds = accessibleProjects.map(
      (p) => p.id as string,
    );
    const { data: matchingDocs } =
      accessibleProjectIds.length > 0
        ? await db
            .from("documents")
            .select("project_id, intake_counterparty")
            .in("project_id", accessibleProjectIds)
            .ilike("intake_counterparty", cpName)
        : { data: [] as { project_id: string }[] };
    const projectIdsViaDocs = new Set(
      (matchingDocs ?? []).map((d) => d.project_id as string),
    );
    const projects = accessibleProjects.filter((p) => {
      const cp = (p.counterparty as string | null)?.trim().toLowerCase();
      if (cp === key) return true;
      return projectIdsViaDocs.has(p.id as string);
    });
    const projectIds = projects.map((p) => p.id as string);

    // Standalone documents the user owns whose intake_counterparty matches.
    const { data: standaloneDocs } = await db
      .from("documents")
      .select(
        "id, project_id, filename, file_type, page_count, created_at, intake_role, intake_status, intake_counterparty, intake_lifecycle_hint, intake_confidence",
      )
      .eq("user_id", userId)
      .is("project_id", null)
      .ilike("intake_counterparty", cpName);

    // Only include the project documents whose counterparty IS this one,
    // OR whose project's primary counterparty IS this one (in which case
    // include all docs in that project). Avoids "Customer Contracts"
    // bucket leaking unrelated counterparties' docs onto this page.
    const primaryProjectIds = projects
      .filter(
        (p) =>
          (p.counterparty as string | null)?.trim().toLowerCase() === key,
      )
      .map((p) => p.id as string);
    const projectDocsPromise =
      projectIds.length > 0
        ? db
            .from("documents")
            .select(
              "id, project_id, filename, file_type, page_count, created_at, intake_role, intake_status, intake_counterparty, intake_lifecycle_hint, intake_confidence",
            )
            .in("project_id", projectIds)
            .or(
              `intake_counterparty.ilike.${cpName}${
                primaryProjectIds.length > 0
                  ? `,project_id.in.(${primaryProjectIds.join(",")})`
                  : ""
              }`,
            )
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as unknown[] });
    const factsPromise =
      projectIds.length > 0
        ? db
            .from("contract_facts")
            .select("*")
            .in("project_id", projectIds)
            .order("extracted_at", { ascending: true })
        : Promise.resolve({ data: [] as unknown[] });
    const [{ data: projectDocs }, { data: facts }] = await Promise.all([
      projectDocsPromise,
      factsPromise,
    ]);

    const documents = [
      ...((projectDocs as Record<string, unknown>[]) ?? []),
      ...((standaloneDocs as Record<string, unknown>[]) ?? []),
    ].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );

    res.json({
      counterparty: cpName,
      projects,
      documents,
      facts: facts ?? [],
    });
  },
);

// POST /projects/counterparties/merge
// Body: { from: string, to: string, role?: string }
// Reassigns every project the caller can write where counterparty == from
// to counterparty = to. Match is case-insensitive on the trimmed value.
// Useful for collapsing "Acme Inc." and "Acme, Inc." into one group.
projectsRouter.post(
  "/counterparties/merge",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from?.trim() || !to?.trim())
      return void res
        .status(400)
        .json({ detail: "from and to are required" });
    const fromKey = from.trim().toLowerCase();
    const toClean = to.trim();

    const db = createServerSupabase();
    const { data: candidates } = await db
      .from("projects")
      .select("id, counterparty")
      .eq("user_id", userId);
    const ids = (candidates ?? [])
      .filter(
        (p) =>
          (p.counterparty as string | null)?.trim().toLowerCase() ===
          fromKey,
      )
      .map((p) => p.id as string);
    if (ids.length === 0) return void res.json({ updated: 0 });

    const { error } = await db
      .from("projects")
      .update({
        counterparty: toClean,
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);
    if (error) return void res.status(500).json({ detail: error.message });
    res.json({ updated: ids.length });
  },
);

// GET /projects/counterparties?role=seller
// Aggregates the user's projects + standalone documents by counterparty
// so the customer index can render "Acme Corp — 4 projects, 7 standalone
// docs, last activity 2 days ago". Standalone docs use intake_counterparty
// + intake_role as their classification. Defaults to role=seller but
// accepts buyer/seller/mutual or "all".
projectsRouter.get("/counterparties", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const role = (req.query.role as string | undefined) ?? "seller";
  const db = createServerSupabase();

  // Don't filter projects by role at the SQL layer — a "Customer Contracts"
  // bucket project may have role=null but contain documents with
  // intake_role=seller, and we want it to surface under /customers. The
  // filtering happens per-document below.
  const { data, error } = await db
    .from("projects")
    .select(
      "id, name, counterparty, parent_counterparty, template, role, updated_at, created_at, user_id, shared_with",
    );
  if (error) return void res.status(500).json({ detail: error.message });

  const accessible = (data ?? []).filter((p) => {
    if (p.user_id === userId) return true;
    if (
      userEmail &&
      Array.isArray(p.shared_with) &&
      p.shared_with.includes(userEmail)
    )
      return true;
    return false;
  });

  type Group = {
    counterparty: string;
    parent_counterparty: string | null;
    project_count: number;
    standalone_count: number;
    last_activity: string;
    projects: { id: string; name: string; updated_at: string }[];
  };
  const byCp = new Map<string, Group>();
  function ensure(cpRaw: string | null, parent: string | null): Group {
    const cp = cpRaw?.trim() || "(Unassigned)";
    const key = cp.toLowerCase();
    const existing = byCp.get(key);
    if (existing) {
      if (!existing.parent_counterparty && parent)
        existing.parent_counterparty = parent;
      return existing;
    }
    const fresh: Group = {
      counterparty: cp,
      parent_counterparty: parent,
      project_count: 0,
      standalone_count: 0,
      last_activity: "",
      projects: [],
    };
    byCp.set(key, fresh);
    return fresh;
  }
  // Pull every document in any accessible project so each project can be
  // credited to all the counterparties present across its docs (a project
  // can be a free-form bucket — e.g. "Customer Contracts" — covering many
  // counterparties).
  const accessibleProjectIds = accessible.map((p) => p.id as string);
  type DocRow = {
    project_id: string | null;
    intake_counterparty: string | null;
    intake_parent_counterparty: string | null;
    intake_role: string | null;
    created_at: string;
    updated_at: string | null;
  };
  let projectDocs: DocRow[] = [];
  if (accessibleProjectIds.length > 0) {
    let pdq = db
      .from("documents")
      .select(
        "project_id, intake_counterparty, intake_parent_counterparty, intake_role, created_at, updated_at",
      )
      .in("project_id", accessibleProjectIds)
      .not("intake_counterparty", "is", null);
    if (role !== "all") pdq = pdq.eq("intake_role", role);
    const { data: pd } = await pdq;
    projectDocs = (pd as DocRow[] | null) ?? [];
  }

  for (const p of accessible) {
    const updatedAt = (p.updated_at as string) ?? (p.created_at as string);
    // Counterparty membership for this project: the explicit primary
    // counterparty on the project (if set) plus every distinct
    // intake_counterparty across its docs.
    const cps = new Set<string>();
    const parents = new Map<string, string>();
    if ((p.counterparty as string | null)?.trim()) {
      const key = (p.counterparty as string).trim();
      cps.add(key);
      if ((p.parent_counterparty as string | null)?.trim())
        parents.set(key.toLowerCase(), p.parent_counterparty as string);
    }
    for (const d of projectDocs) {
      if (d.project_id !== p.id) continue;
      const cp = d.intake_counterparty?.trim();
      if (!cp) continue;
      cps.add(cp);
      if (d.intake_parent_counterparty?.trim())
        parents.set(cp.toLowerCase(), d.intake_parent_counterparty);
    }
    if (cps.size === 0) {
      // Untagged project — still surface under "(Unassigned)" but only
      // when the role filter allows it (we don't have a role for unset
      // projects so include in "all" only).
      if (role !== "all") continue;
      const g = ensure(null, null);
      g.project_count += 1;
      g.projects.push({
        id: p.id as string,
        name: p.name as string,
        updated_at: updatedAt,
      });
      if (updatedAt > g.last_activity) g.last_activity = updatedAt;
      continue;
    }
    for (const cp of cps) {
      const g = ensure(cp, parents.get(cp.toLowerCase()) ?? null);
      g.project_count += 1;
      g.projects.push({
        id: p.id as string,
        name: p.name as string,
        updated_at: updatedAt,
      });
      if (updatedAt > g.last_activity) g.last_activity = updatedAt;
    }
  }

  // Pull in the user's standalone documents (project_id IS NULL) that have
  // an intake_role matching the requested filter, so the customer index
  // surfaces orphan contracts (NDAs, one-offs, historical imports) too.
  let docQuery = db
    .from("documents")
    .select(
      "id, intake_counterparty, intake_parent_counterparty, intake_role, created_at, updated_at",
    )
    .eq("user_id", userId)
    .is("project_id", null)
    .not("intake_counterparty", "is", null);
  if (role !== "all") docQuery = docQuery.eq("intake_role", role);
  const { data: standaloneDocs } = await docQuery;
  for (const d of standaloneDocs ?? []) {
    const g = ensure(
      d.intake_counterparty as string | null,
      (d.intake_parent_counterparty as string | null) ?? null,
    );
    g.standalone_count += 1;
    const updatedAt = (d.updated_at as string) ?? (d.created_at as string);
    if (updatedAt > g.last_activity) g.last_activity = updatedAt;
  }

  const groups = Array.from(byCp.values()).sort((a, b) =>
    a.counterparty.localeCompare(b.counterparty),
  );
  res.json(groups);
});

// GET /projects/:projectId/facts
// Returns the contract_facts rows for this project, newest first. Lets the
// project page render a "Key terms" panel and a lifecycle timeline.
projectsRouter.get("/:projectId/facts", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { projectId } = req.params;
  const db = createServerSupabase();
  const { data: project } = await db
    .from("projects")
    .select("user_id, shared_with")
    .eq("id", projectId)
    .single();
  if (!project) return void res.status(404).json({ detail: "Project not found" });
  const canAccess =
    project.user_id === userId ||
    (userEmail &&
      Array.isArray(project.shared_with) &&
      project.shared_with.includes(userEmail));
  if (!canAccess)
    return void res.status(404).json({ detail: "Project not found" });

  const { data, error } = await db
    .from("contract_facts")
    .select("*")
    .eq("project_id", projectId)
    .order("extracted_at", { ascending: false });
  if (error) return void res.status(500).json({ detail: error.message });
  res.json(data ?? []);
});

// GET /projects/:projectId
projectsRouter.get("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const { projectId } = req.params;
  const db = createServerSupabase();

  const { data: project, error } = await db
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error || !project)
    return void res.status(404).json({ detail: "Project not found" });

  const canAccess =
    project.user_id === userId ||
    (userEmail &&
      Array.isArray(project.shared_with) &&
      project.shared_with.includes(userEmail));
  if (!canAccess)
    return void res.status(404).json({ detail: "Project not found" });

  const [{ data: docs }, { data: folderData }] = await Promise.all([
    db.from("documents").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    db.from("project_subfolders").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
  ]);
  const docsTyped = (docs ?? []) as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  res.json({
    ...project,
    is_owner: project.user_id === userId,
    documents: docsTyped,
    folders: folderData ?? [],
  });
});

// GET /projects/:projectId/people
// Resolve the owner + every shared member to {email, display_name}. Used
// by the People modal so the UI can show display names where available
// and tag the current user as "You".
projectsRouter.get("/:projectId/people", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;
  const db = createServerSupabase();

  const { data: project } = await db
    .from("projects")
    .select("id, user_id, shared_with")
    .eq("id", projectId)
    .single();
  if (!project)
    return void res.status(404).json({ detail: "Project not found" });

  const isOwner = project.user_id === userId;
  const sharedWith = (Array.isArray(project.shared_with)
    ? (project.shared_with as string[])
    : []
  ).map((e) => e.toLowerCase());
  const isShared =
    !!userEmail && sharedWith.includes(userEmail.toLowerCase());
  if (!isOwner && !isShared)
    return void res.status(404).json({ detail: "Project not found" });

  // Pull every auth user (matching the lookup endpoint's pattern). For
  // larger deployments this should page or be replaced with a bulk-by-id
  // RPC, but it keeps things simple while user counts are modest.
  const { data: usersData } = await db.auth.admin.listUsers({ perPage: 1000 });
  const allUsers = usersData?.users ?? [];
  const userByEmail = new Map<string, { id: string; email: string }>();
  const userById = new Map<string, { id: string; email: string }>();
  for (const u of allUsers) {
    if (!u.email) continue;
    const lower = u.email.toLowerCase();
    userByEmail.set(lower, { id: u.id, email: u.email });
    userById.set(u.id, { id: u.id, email: u.email });
  }

  const memberUserIds: string[] = [];
  for (const email of sharedWith) {
    const u = userByEmail.get(email);
    if (u) memberUserIds.push(u.id);
  }

  const profileIds = [
    project.user_id as string,
    ...memberUserIds,
  ].filter((x, i, arr) => arr.indexOf(x) === i);

  const profileByUserId = new Map<
    string,
    { display_name: string | null; organisation: string | null }
  >();
  if (profileIds.length > 0) {
    const { data: profiles } = await db
      .from("user_profiles")
      .select("user_id, display_name, organisation")
      .in("user_id", profileIds);
    for (const p of profiles ?? []) {
      profileByUserId.set(p.user_id as string, {
        display_name: (p.display_name as string | null) ?? null,
        organisation: (p.organisation as string | null) ?? null,
      });
    }
  }

  const ownerInfo = userById.get(project.user_id as string);
  const owner = {
    user_id: project.user_id,
    email: ownerInfo?.email ?? null,
    display_name:
      profileByUserId.get(project.user_id as string)?.display_name ?? null,
  };
  const members = sharedWith.map((email) => {
    const u = userByEmail.get(email);
    const display_name = u
      ? profileByUserId.get(u.id)?.display_name ?? null
      : null;
    return { email, display_name };
  });

  res.json({ owner, members });
});

// PATCH /projects/:projectId
projectsRouter.patch("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { projectId } = req.params;
  const updates: Record<string, unknown> = {};
  if (req.body.name != null) updates.name = req.body.name;
  if (req.body.cm_number != null) updates.cm_number = req.body.cm_number;
  if (req.body.counterparty !== undefined)
    updates.counterparty = req.body.counterparty || null;
  if (req.body.parent_counterparty !== undefined)
    updates.parent_counterparty = req.body.parent_counterparty || null;
  if (req.body.template !== undefined) {
    if (req.body.template === null || req.body.template === "") {
      updates.template = null;
      updates.role = null;
    } else {
      const tmpl = getTemplate(req.body.template);
      if (!tmpl)
        return void res.status(400).json({ detail: "Unknown template" });
      updates.template = tmpl.slug;
      updates.role = tmpl.role;
    }
  }
  if (Array.isArray(req.body.shared_with)) {
    // Normalise: lowercase + dedupe + drop empties.
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of req.body.shared_with) {
      if (typeof raw !== "string") continue;
      const e = raw.trim().toLowerCase();
      if (!e || seen.has(e)) continue;
      seen.add(e);
      cleaned.push(e);
    }
    updates.shared_with = cleaned;
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("projects")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data)
    return void res.status(404).json({ detail: "Project not found" });

  const [{ data: docs }, { data: folderData }] = await Promise.all([
    db.from("documents").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    db.from("project_subfolders").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
  ]);
  const docsTyped = (docs ?? []) as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachActiveVersionPaths(db, docsTyped);
  res.json({ ...data, documents: docsTyped, folders: folderData ?? [] });
});

// DELETE /projects/:projectId
projectsRouter.delete("/:projectId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const { projectId } = req.params;
  const db = createServerSupabase();
  const { error } = await db
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
});

// GET /projects/:projectId/documents
projectsRouter.get("/:projectId/documents", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;
  const db = createServerSupabase();

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  const { data: docs } = await db
    .from("documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  const docsTyped = (docs ?? []) as unknown as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachActiveVersionPaths(db, docsTyped);
  res.json(docsTyped);
});

// POST /projects/:projectId/documents/:documentId — assign or copy existing doc into project
projectsRouter.post(
  "/:projectId/documents/:documentId",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId, documentId } = req.params;
    const db = createServerSupabase();

    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    // Adding-by-id pulls a doc into the project — only the doc's owner
    // is allowed to do that, so other people's standalone docs can't be
    // siphoned into a project the requester happens to share.
    const { data: doc } = await db
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .eq("user_id", userId)
      .single();
    if (!doc)
      return void res.status(404).json({ detail: "Document not found" });

    // Already in this project — idempotent
    if (doc.project_id === projectId) return void res.json(doc);

    if (doc.project_id === null) {
      // Standalone → assign project_id
      const { data: updated, error } = await db
        .from("documents")
        .update({ project_id: projectId, updated_at: new Date().toISOString() })
        .eq("id", documentId)
        .select("*")
        .single();
      if (error || !updated)
        return void res.status(500).json({ detail: "Failed to update document" });
      return void res.json(updated);
    } else {
      // Belongs to another project → duplicate record AND copy the
      // underlying storage objects so each project's copy is fully
      // independent (edits/version bumps on one don't leak into the
      // other).
      const { data: copy, error } = await db
        .from("documents")
        .insert({
          project_id: projectId,
          user_id: userId,
          filename: doc.filename,
          file_type: doc.file_type,
          size_bytes: doc.size_bytes,
          page_count: doc.page_count,
          structure_tree: doc.structure_tree,
          status: doc.status,
        })
        .select("*")
        .single();
      if (error || !copy)
        return void res.status(500).json({ detail: "Failed to copy document" });

      let copyVersionRowId: string | null = null;
      if (doc.current_version_id) {
        const { data: srcV } = await db
          .from("document_versions")
          .select(
            "storage_path, pdf_storage_path, version_number, display_name, source",
          )
          .eq("id", doc.current_version_id)
          .single();
        if (srcV?.storage_path) {
          const srcBytes = await downloadFile(srcV.storage_path);
          if (!srcBytes) {
            return void res
              .status(500)
              .json({ detail: "Failed to read source document bytes" });
          }
          const newKey = storageKey(userId, copy.id as string, doc.filename);
          const contentType =
            doc.file_type === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          await uploadFile(newKey, srcBytes, contentType);

          // PDFs share one object for source + display rendition. DOCX
          // store the converted PDF at a separate `converted-pdfs/` key —
          // copy that too if it exists so the copy renders without going
          // back through libreoffice.
          let newPdfPath: string | null = null;
          if (srcV.pdf_storage_path) {
            if (srcV.pdf_storage_path === srcV.storage_path) {
              newPdfPath = newKey;
            } else {
              const pdfBytes = await downloadFile(srcV.pdf_storage_path);
              if (pdfBytes) {
                const newPdfKey = convertedPdfKey(userId, copy.id as string);
                await uploadFile(newPdfKey, pdfBytes, "application/pdf");
                newPdfPath = newPdfKey;
              }
            }
          }

          const { data: newV } = await db
            .from("document_versions")
            .insert({
              document_id: copy.id,
              storage_path: newKey,
              pdf_storage_path: newPdfPath,
              source: (srcV.source as string | null) ?? "upload",
              version_number: srcV.version_number ?? 1,
              display_name: srcV.display_name ?? doc.filename,
            })
            .select("id")
            .single();
          copyVersionRowId = (newV?.id as string | null) ?? null;
          if (copyVersionRowId) {
            await db
              .from("documents")
              .update({ current_version_id: copyVersionRowId })
              .eq("id", copy.id);
          }
        }
      }
      return void res.status(201).json(copy);
    }
  },
);

// POST /projects/:projectId/documents
projectsRouter.post(
  "/:projectId/documents",
  requireAuth,
  singleFileUpload("file"),
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;
    const db = createServerSupabase();

    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok)
      return void res.status(404).json({ detail: "Project not found" });

    await handleDocumentUpload(req, res, userId, projectId, db);
  },
);

// GET /projects/:projectId/chats — every assistant chat under this project
// (any author with project access). Used by the project page's chat tab so
// it doesn't have to filter the global GET /chat list — and so collaborators
// see each other's chats inside the project even though those don't appear
// in the global list.
projectsRouter.get("/:projectId/chats", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;
  const db = createServerSupabase();

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok)
    return void res.status(404).json({ detail: "Project not found" });

  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return void res.status(500).json({ detail: error.message });
  res.json(data ?? []);
});

// ── Folder routes ─────────────────────────────────────────────────────────────

// POST /projects/:projectId/folders
projectsRouter.post("/:projectId/folders", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId } = req.params;
  const { name, parent_folder_id } = req.body as { name: string; parent_folder_id?: string | null };
  if (!name?.trim()) return void res.status(400).json({ detail: "name is required" });

  const db = createServerSupabase();
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  // Verify parent folder belongs to this project
  if (parent_folder_id) {
    const { data: parent } = await db.from("project_subfolders").select("id").eq("id", parent_folder_id).eq("project_id", projectId).single();
    if (!parent) return void res.status(404).json({ detail: "Parent folder not found" });
  }

  const { data, error } = await db.from("project_subfolders").insert({
    project_id: projectId,
    user_id: userId,
    name: name.trim(),
    parent_folder_id: parent_folder_id ?? null,
  }).select("*").single();
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(201).json(data);
});

// PATCH /projects/:projectId/folders/:folderId
projectsRouter.patch("/:projectId/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId, folderId } = req.params;
  const body = req.body as { name?: string; parent_folder_id?: string | null };

  const db = createServerSupabase();
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name != null) updates.name = body.name.trim();
  if ("parent_folder_id" in body) {
    // Cycle check: walk up the tree from the proposed parent to ensure folderId is not an ancestor
    if (body.parent_folder_id) {
      let cur: string | null = body.parent_folder_id;
      while (cur) {
        if (cur === folderId) return void res.status(400).json({ detail: "Cannot move a folder into itself or a descendant" });
        const { data: p }: { data: { parent_folder_id: string | null } | null } =
          await db.from("project_subfolders").select("parent_folder_id").eq("id", cur).single();
        cur = p?.parent_folder_id ?? null;
      }
    }
    updates.parent_folder_id = body.parent_folder_id ?? null;
  }

  const { data, error } = await db.from("project_subfolders")
    .update(updates)
    .eq("id", folderId).eq("project_id", projectId)
    .select("*").single();
  if (error || !data) return void res.status(404).json({ detail: "Folder not found" });
  res.json(data);
});

// DELETE /projects/:projectId/folders/:folderId
projectsRouter.delete("/:projectId/folders/:folderId", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId, folderId } = req.params;
  const db = createServerSupabase();

  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  // Move direct documents to root before cascade-deleting subfolders
  await db.from("documents").update({ folder_id: null }).eq("folder_id", folderId);

  const { error } = await db.from("project_subfolders")
    .delete().eq("id", folderId).eq("project_id", projectId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
});

// PATCH /projects/:projectId/documents/:documentId/folder — move doc to a folder
projectsRouter.patch("/:projectId/documents/:documentId/folder", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string | undefined;
  const { projectId, documentId } = req.params;
  const { folder_id } = req.body as { folder_id: string | null };

  const db = createServerSupabase();
  const access = await checkProjectAccess(projectId, userId, userEmail, db);
  if (!access.ok) return void res.status(404).json({ detail: "Project not found" });

  const { data, error } = await db.from("documents")
    .update({ folder_id: folder_id ?? null, updated_at: new Date().toISOString() })
    .eq("id", documentId).eq("project_id", projectId)
    .select("*").single();
  if (error || !data) return void res.status(404).json({ detail: "Document not found" });
  res.json(data);
});

export async function handleDocumentUpload(
  req: import("express").Request,
  res: import("express").Response,
  userId: string,
  projectId: string | null,
  db: ReturnType<typeof createServerSupabase>,
) {
  const file = req.file;
  if (!file) return void res.status(400).json({ detail: "file is required" });

  const filename = file.originalname;
  const suffix = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  if (!ALLOWED_TYPES.has(suffix))
    return void res
      .status(400)
      .json({
        detail: `Unsupported file type: ${suffix}. Allowed: pdf, docx, doc`,
      });

  const content = file.buffer;
  const { data: doc, error: insertErr } = await db
    .from("documents")
    .insert({
      project_id: projectId,
      user_id: userId,
      filename,
      file_type: suffix,
      size_bytes: content.byteLength,
      status: "processing",
    })
    .select("*")
    .single();

  if (insertErr || !doc)
    return void res
      .status(500)
      .json({ detail: "Failed to create document record" });

  try {
    const docId = doc.id as string;
    const key = storageKey(userId, docId, filename);
    const contentType =
      suffix === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await uploadFile(
      key,
      content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer,
      contentType,
    );

    const rawBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    const tree = await extractStructureTree(rawBuf, suffix, filename);
    const pageCount = suffix === "pdf" ? await countPdfPages(rawBuf) : null;

    // Convert DOCX/DOC → PDF for display. PDFs are their own rendition.
    let pdfStoragePath: string | null = null;
    if (suffix === "docx" || suffix === "doc") {
      try {
        const pdfBuf = await docxToPdf(content);
        const pdfKey = convertedPdfKey(userId, docId);
        await uploadFile(
          pdfKey,
          pdfBuf.buffer.slice(
            pdfBuf.byteOffset,
            pdfBuf.byteOffset + pdfBuf.byteLength,
          ) as ArrayBuffer,
          "application/pdf",
        );
        pdfStoragePath = pdfKey;
      } catch (err) {
        console.error(
          `[upload] DOCX→PDF conversion failed for ${filename}:`,
          err,
        );
      }
    } else if (suffix === "pdf") {
      pdfStoragePath = key;
    }

    // Storage paths live on document_versions — create the V1 row and
    // point documents.current_version_id at it.
    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: docId,
        storage_path: key,
        pdf_storage_path: pdfStoragePath,
        source: "upload",
        version_number: 1,
        display_name: filename,
      })
      .select("id")
      .single();
    if (verErr || !versionRow) {
      throw new Error(
        `Failed to record upload version: ${verErr?.message ?? "unknown"}`,
      );
    }

    await db
      .from("documents")
      .update({
        current_version_id: versionRow.id,
        size_bytes: content.byteLength,
        page_count: pageCount,
        structure_tree: tree ?? null,
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", docId);

    const { data: updated } = await db
      .from("documents")
      .select("*")
      .eq("id", docId)
      .single();
    const responseDoc = updated
      ? {
            ...updated,
            storage_path: key,
            pdf_storage_path: pdfStoragePath,
        }
      : updated;
    // Fire-and-forget: if this project has a vendor/customer template and
    // no counterparty set yet, kick off LLM extraction. Never blocks the
    // upload response and silently ignores failures.
    if (projectId) {
      void maybeAutofillCounterparty({
        projectId,
        documentId: doc.id as string,
        userId,
      });
    }
    // Always extract structured contract facts on upload (regardless of
    // template). Builds the lifecycle dataset.
    void maybeExtractContractFacts({
      projectId,
      documentId: doc.id as string,
      userId,
    });
    // Always run intake classification — populates role, status, lifecycle
    // hint, and counterparty even for project-attached uploads (the
    // /intake page filters to project_id IS NULL but the data is useful
    // everywhere).
    void maybeAnalyzeIntake({ documentId: doc.id as string, userId });
    return void res.status(201).json(responseDoc);
  } catch (e) {
    await db.from("documents").update({ status: "error" }).eq("id", doc.id);
    return void res
      .status(500)
      .json({ detail: `Document processing failed: ${String(e)}` });
  }
}

async function countPdfPages(buf: ArrayBuffer): Promise<number | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
    const pdf = await (
      pdfjsLib as unknown as {
        getDocument: (opts: unknown) => {
          promise: Promise<{ numPages: number }>;
        };
      }
    ).getDocument({ data: new Uint8Array(buf) }).promise;
    return pdf.numPages;
  } catch {
    return null;
  }
}

async function extractStructureTree(
  content: ArrayBuffer,
  fileType: string,
  filename: string,
): Promise<unknown[] | null> {
  try {
    if (fileType === "pdf") {
      const pdfjsLib = await import(
        "pdfjs-dist/legacy/build/pdf.mjs" as string
      );
      const pdf = await (
        pdfjsLib as unknown as {
          getDocument: (opts: unknown) => {
            promise: Promise<{
              numPages: number;
              getOutline: () => Promise<{ title?: string }[]>;
            }>;
          };
        }
      ).getDocument({ data: new Uint8Array(content) }).promise;
      if (pdf.numPages <= 5) return null;
      const outline = await pdf.getOutline();
      if (outline?.length) {
        return outline.map((item, i) => ({
          id: `h1-${i}`,
          title: item.title ?? `Item ${i + 1}`,
          level: 1,
          page_number: null,
          children: [],
        }));
      }
      return Array.from({ length: pdf.numPages }, (_, i) => ({
        id: `page-${i + 1}`,
        title: `Page ${i + 1}`,
        level: 1,
        page_number: i + 1,
        children: [],
      }));
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(content),
      });
      const lines = result.value.split("\n").filter((l) => l.trim());
      const nodes = lines
        .slice(0, 30)
        .map((line, i) => ({
          id: `h1-${i}`,
          title: line.slice(0, 100),
          level: 1,
          page_number: null,
          children: [],
        }));
      return nodes.length ? nodes : null;
    }
  } catch {
    return null;
  }
}

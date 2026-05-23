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
import { maybeExtractContractFacts } from "../lib/contractFacts";
import { maybeAnalyzeIntake } from "../lib/intakeAnalysis";
import { slugifyCounterparty } from "../lib/slug";

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

// Counterparty endpoints. Counterparty is a pure document-level concept now
// (documents.intake_counterparty). Projects are free-form buckets with no
// counterparty field — the `/customers` index aggregates documents and
// groups them by a deterministic slug so "Airbnb, Inc" and "Airbnb, Inc."
// collapse into a single row.

type CpDocRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  intake_counterparty: string | null;
  intake_parent_counterparty: string | null;
  intake_role: string | null;
  intake_status: string | null;
  intake_lifecycle_hint: string | null;
  intake_summary: string | null;
  intake_confidence: number | null;
  filename: string;
  file_type: string;
  page_count: number | null;
  created_at: string;
  updated_at: string | null;
};

async function loadAccessibleDocsWithCounterparty(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
  userEmail: string,
): Promise<{ docs: CpDocRow[]; projectsById: Map<string, { id: string; name: string; template: string | null; updated_at: string; created_at: string }> }> {
  // Find projects the user can access.
  const { data: allProjects } = await db
    .from("projects")
    .select("id, name, template, user_id, shared_with, created_at, updated_at");
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
  const projectIds = accessibleProjects.map((p) => p.id as string);
  const projectsById = new Map<string, { id: string; name: string; template: string | null; updated_at: string; created_at: string }>();
  for (const p of accessibleProjects) {
    projectsById.set(p.id as string, {
      id: p.id as string,
      name: p.name as string,
      template: (p.template as string | null) ?? null,
      created_at: p.created_at as string,
      updated_at: (p.updated_at as string) ?? (p.created_at as string),
    });
  }

  const docCols =
    "id, user_id, project_id, filename, file_type, page_count, created_at, updated_at, intake_role, intake_status, intake_counterparty, intake_parent_counterparty, intake_lifecycle_hint, intake_summary, intake_confidence";

  // Standalone docs the user owns + project-attached docs in any accessible
  // project. Loaded as two queries since they have different access rules.
  const standalonePromise = db
    .from("documents")
    .select(docCols)
    .eq("user_id", userId)
    .is("project_id", null)
    .not("intake_counterparty", "is", null);
  const projectDocsPromise =
    projectIds.length > 0
      ? db
          .from("documents")
          .select(docCols)
          .in("project_id", projectIds)
          .not("intake_counterparty", "is", null)
      : Promise.resolve({ data: [] as unknown[] });
  const [{ data: standaloneDocs }, { data: projectDocs }] = await Promise.all([
    standalonePromise,
    projectDocsPromise,
  ]);
  const docs = [
    ...((standaloneDocs as CpDocRow[] | null) ?? []),
    ...((projectDocs as CpDocRow[] | null) ?? []),
  ];
  return { docs, projectsById };
}

// GET /projects/counterparties?role=seller
// Aggregates documents (project-attached + standalone) by counterparty slug
// so the customer index can render "Acme Corp — 12 documents across 3
// projects, last activity 2 days ago". Defaults to role=seller; pass "all"
// to skip the role filter.
projectsRouter.get("/counterparties", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const userEmail = res.locals.userEmail as string;
  const role = (req.query.role as string | undefined) ?? "seller";
  const db = createServerSupabase();

  const { docs, projectsById } = await loadAccessibleDocsWithCounterparty(
    db,
    userId,
    userEmail,
  );

  type Group = {
    slug: string;
    counterparty: string; // canonical display name
    parent_counterparty: string | null;
    project_count: number;
    standalone_count: number;
    document_count: number;
    last_activity: string;
    projects: { id: string; name: string; updated_at: string }[];
    // Track which display names we've seen so we can pick a canonical one.
    _nameCounts: Map<string, number>;
  };
  const bySlug = new Map<string, Group>();

  for (const d of docs) {
    const cp = d.intake_counterparty?.trim();
    if (!cp) continue;
    if (role !== "all" && d.intake_role !== role) continue;
    const slug = slugifyCounterparty(cp);
    if (!slug) continue;
    let g = bySlug.get(slug);
    if (!g) {
      g = {
        slug,
        counterparty: cp,
        parent_counterparty: null,
        project_count: 0,
        standalone_count: 0,
        document_count: 0,
        last_activity: "",
        projects: [],
        _nameCounts: new Map(),
      };
      bySlug.set(slug, g);
    }
    g._nameCounts.set(cp, (g._nameCounts.get(cp) ?? 0) + 1);
    if (!g.parent_counterparty && d.intake_parent_counterparty?.trim())
      g.parent_counterparty = d.intake_parent_counterparty.trim();
    g.document_count += 1;
    const docTime = d.updated_at ?? d.created_at;
    if (docTime && docTime > g.last_activity) g.last_activity = docTime;

    if (d.project_id) {
      const proj = projectsById.get(d.project_id);
      if (proj && !g.projects.some((p) => p.id === proj.id)) {
        g.projects.push({
          id: proj.id,
          name: proj.name,
          updated_at: proj.updated_at,
        });
        g.project_count += 1;
      }
    } else {
      g.standalone_count += 1;
    }
  }

  // Pick canonical display name = the most common variant we saw.
  const groups = Array.from(bySlug.values()).map((g) => {
    let best = g.counterparty;
    let bestCount = -1;
    for (const [name, count] of g._nameCounts) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    return {
      slug: g.slug,
      counterparty: best,
      parent_counterparty: g.parent_counterparty,
      project_count: g.project_count,
      standalone_count: g.standalone_count,
      document_count: g.document_count,
      last_activity: g.last_activity,
      projects: g.projects,
    };
  });
  groups.sort((a, b) => a.counterparty.localeCompare(b.counterparty));
  res.json(groups);
});

// GET /projects/counterparties/:slug/timeline
// Per-counterparty detail: every document associated with this counterparty
// (across all projects + standalone), enriched with contract_facts so the
// frontend can render a timeline keyed on extracted effective_date.
projectsRouter.get(
  "/counterparties/:slug/timeline",
  requireAuth,
  async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string;
    const slug = req.params.slug.trim().toLowerCase();
    if (!slug) return void res.status(400).json({ detail: "slug required" });

    const db = createServerSupabase();
    const { docs, projectsById } = await loadAccessibleDocsWithCounterparty(
      db,
      userId,
      userEmail,
    );
    const matching = docs.filter((d) => {
      const cp = d.intake_counterparty?.trim();
      if (!cp) return false;
      return slugifyCounterparty(cp) === slug;
    });
    if (matching.length === 0) {
      return void res.json({
        slug,
        counterparty: slug,
        projects: [],
        documents: [],
        facts: [],
      });
    }
    // Pick canonical display name from this counterparty's docs.
    const nameCounts = new Map<string, number>();
    for (const d of matching) {
      const cp = d.intake_counterparty!.trim();
      nameCounts.set(cp, (nameCounts.get(cp) ?? 0) + 1);
    }
    let canonical = matching[0].intake_counterparty!.trim();
    let bestCount = -1;
    for (const [name, count] of nameCounts) {
      if (count > bestCount) {
        canonical = name;
        bestCount = count;
      }
    }

    // Distinct projects that have at least one matching doc.
    const projectIdSet = new Set(
      matching.map((d) => d.project_id).filter((x): x is string => !!x),
    );
    const projects = Array.from(projectIdSet)
      .map((id) => projectsById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);

    // Pull contract_facts for the matching doc set (per-doc lookup).
    const docIds = matching.map((d) => d.id);
    const { data: facts } = await db
      .from("contract_facts")
      .select("*")
      .in("document_id", docIds)
      .order("extracted_at", { ascending: true });

    const documents = matching
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    res.json({
      slug,
      counterparty: canonical,
      projects,
      documents,
      facts: facts ?? [],
    });
  },
);

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

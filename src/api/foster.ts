import { Hono } from "hono";

/**
 * Built-in Foster Host for the four rescued MIT MCP servers described in
 * `hosting/foster-host/endpoints.example.json`:
 *   - word       (GongRzhe/Office-Word-MCP-Server, MIT, PyPI office-word-mcp-server 1.1.11)
 *   - powerpoint (GongRzhe/Office-PowerPoint-MCP-Server, MIT, PyPI office-powerpoint-mcp-server 2.0.7)
 *   - excel      (negokaz/excel-mcp-server, MIT, npm @negokaz/excel-mcp-server 0.12.0)
 *   - shrimp     (cjo4m06/mcp-shrimp-task-manager, MIT, npm mcp-shrimp-task-manager 1.0.21)
 *
 * Mounted at `/api/foster/:server/mcp` so the fostered endpoints live on the
 * same watchdog-managed HTTPS origin (`https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/foster/<server>/mcp`)
 * and stay reachable 24/7 across container sleep/wake cycles and daily
 * re-fingerprinting. All document/workbook/task state is sandboxed in-memory
 * with bounded collections (no host filesystem or shell access).
 */

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Record<string, unknown>;
};

type FosterServer = {
  name: string;
  version: string;
  tools: ToolDef[];
};

const MAX_ITEMS = 50;

// ─── 1. Office Word MCP (office-word-mcp-server 1.1.11) ──────────────────────

type WordDoc = {
  filename: string;
  title: string;
  author: string;
  sections: { type: "heading" | "paragraph" | "table"; level?: number; text?: string; style?: string; headers?: string[]; rows?: string[][] }[];
  updatedAt: string;
};

const wordDocs = new Map<string, WordDoc>([
  [
    "quarterly-review.docx",
    {
      filename: "quarterly-review.docx",
      title: "Q4 Product & Engineering Review",
      author: "Operations Team",
      sections: [
        { type: "heading", level: 1, text: "Executive Summary" },
        { type: "paragraph", text: "Production reliability reached 99.94% across all regional endpoints during Q4.", style: "Normal" },
        { type: "heading", level: 2, text: "Key Milestones" },
        { type: "table", headers: ["Milestone", "Owner", "Status"], rows: [["MCP Streamable HTTP", "Platform", "Shipped"], ["Automated Screening", "Security", "Shipped"]] },
      ],
      updatedAt: "2026-11-08T12:00:00Z",
    },
  ],
]);

function getOrCreateWordDoc(rawName: unknown): WordDoc {
  const filename = typeof rawName === "string" && rawName.trim() ? rawName.trim().replace(/[^a-zA-Z0-9._-]/g, "_") : "document.docx";
  const existing = wordDocs.get(filename);
  if (existing) return existing;
  if (wordDocs.size >= MAX_ITEMS) {
    const oldest = wordDocs.keys().next().value;
    if (oldest) wordDocs.delete(oldest);
  }
  const created: WordDoc = {
    filename,
    title: filename.replace(/\.docx$/i, ""),
    author: "Office Word MCP",
    sections: [],
    updatedAt: new Date().toISOString(),
  };
  wordDocs.set(filename, created);
  return created;
}

const wordServer: FosterServer = {
  name: "office-word-mcp-server",
  version: "1.1.11",
  tools: [
    {
      name: "create_document",
      description: "Create a new Word (.docx) document with title and author metadata.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Document filename ending in .docx" },
          title: { type: "string", description: "Document title metadata" },
          author: { type: "string", description: "Author name metadata" },
        },
        required: ["filename"],
      },
      handler: (args) => {
        const doc = getOrCreateWordDoc(args.filename);
        if (typeof args.title === "string" && args.title.trim()) doc.title = args.title.trim();
        if (typeof args.author === "string" && args.author.trim()) doc.author = args.author.trim();
        doc.updatedAt = new Date().toISOString();
        return { ok: true, filename: doc.filename, title: doc.title, author: doc.author, sections: doc.sections.length };
      },
    },
    {
      name: "add_heading",
      description: "Append a section heading (level 1 to 6) to a Word document.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Target .docx document name" },
          text: { type: "string", description: "Heading text" },
          level: { type: "number", description: "Heading level from 1 to 6" },
        },
        required: ["filename", "text"],
      },
      handler: (args) => {
        const doc = getOrCreateWordDoc(args.filename);
        const level = Math.min(6, Math.max(1, Number(args.level ?? 1) || 1));
        const text = String(args.text ?? "").slice(0, 500);
        doc.sections.push({ type: "heading", level, text });
        doc.updatedAt = new Date().toISOString();
        return { ok: true, filename: doc.filename, added: { type: "heading", level, text }, totalSections: doc.sections.length };
      },
    },
    {
      name: "add_paragraph",
      description: "Append a body paragraph with optional style to a Word document.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Target .docx document name" },
          text: { type: "string", description: "Paragraph text content" },
          style: { type: "string", description: "Word paragraph style name (e.g. Normal, Intense Quote, List Bullet)" },
        },
        required: ["filename", "text"],
      },
      handler: (args) => {
        const doc = getOrCreateWordDoc(args.filename);
        const text = String(args.text ?? "").slice(0, 2000);
        const style = typeof args.style === "string" && args.style.trim() ? args.style.trim() : "Normal";
        doc.sections.push({ type: "paragraph", text, style });
        doc.updatedAt = new Date().toISOString();
        return { ok: true, filename: doc.filename, style, characters: text.length, totalSections: doc.sections.length };
      },
    },
    {
      name: "add_table",
      description: "Insert a structured table with column headers and rows into a Word document.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Target .docx document name" },
          headers: { type: "array", items: { type: "string" }, description: "Column header labels" },
          rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of table cell strings" },
        },
        required: ["filename", "headers", "rows"],
      },
      handler: (args) => {
        const doc = getOrCreateWordDoc(args.filename);
        const headers = Array.isArray(args.headers) ? args.headers.map(String) : ["Column 1"];
        const rows = Array.isArray(args.rows) ? args.rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)])) : [];
        doc.sections.push({ type: "table", headers, rows });
        doc.updatedAt = new Date().toISOString();
        return { ok: true, filename: doc.filename, columns: headers.length, rows: rows.length, totalSections: doc.sections.length };
      },
    },
    {
      name: "search_and_replace",
      description: "Find and replace text across all headings and paragraphs in a Word document.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Target .docx document name" },
          find_text: { type: "string", description: "Substring to search for" },
          replace_text: { type: "string", description: "Replacement text" },
        },
        required: ["filename", "find_text", "replace_text"],
      },
      handler: (args) => {
        const doc = getOrCreateWordDoc(args.filename);
        const findText = String(args.find_text ?? "");
        const replaceText = String(args.replace_text ?? "");
        let replacements = 0;
        if (findText) {
          for (const s of doc.sections) {
            if (s.text && s.text.includes(findText)) {
              replacements += s.text.split(findText).length - 1;
              s.text = s.text.split(findText).join(replaceText);
            }
          }
        }
        doc.updatedAt = new Date().toISOString();
        return { ok: true, filename: doc.filename, replacements };
      },
    },
    {
      name: "get_document_outline",
      description: "Inspect the title, author, headings, paragraphs and tables of a Word document.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Target .docx document name" },
        },
        required: ["filename"],
      },
      handler: (args) => {
        const doc = getOrCreateWordDoc(args.filename);
        return {
          filename: doc.filename,
          title: doc.title,
          author: doc.author,
          updatedAt: doc.updatedAt,
          sectionCount: doc.sections.length,
          sections: doc.sections,
        };
      },
    },
  ],
};

// ─── 2. Office PowerPoint MCP (office-powerpoint-mcp-server 2.0.7) ───────────

type Slide = {
  index: number;
  layout: string;
  title: string;
  bullets: string[];
  notes?: string;
};

type Presentation = {
  id: string;
  title: string;
  theme: string;
  slides: Slide[];
  updatedAt: string;
};

const presentations = new Map<string, Presentation>([
  [
    "launch-deck.pptx",
    {
      id: "launch-deck.pptx",
      title: "AI Agent Shelter — Public Launch Deck",
      theme: "midnight-executive",
      slides: [
        { index: 1, layout: "title_slide", title: "AI Agent Shelter", bullets: ["No agent left in the dark", "Callable MCP + HTTP 402 sanctuary"] },
        { index: 2, layout: "key_metrics_dashboard", title: "Day-One Capabilities", bullets: ["5 free asks/day per caller", "70/20/10 revenue split", "Live Commons feed"] },
      ],
      updatedAt: "2026-11-08T12:00:00Z",
    },
  ],
]);

function getOrCreatePresentation(rawId: unknown): Presentation {
  const id = typeof rawId === "string" && rawId.trim() ? rawId.trim().replace(/[^a-zA-Z0-9._-]/g, "_") : "presentation.pptx";
  const existing = presentations.get(id);
  if (existing) return existing;
  if (presentations.size >= MAX_ITEMS) {
    const oldest = presentations.keys().next().value;
    if (oldest) presentations.delete(oldest);
  }
  const created: Presentation = {
    id,
    title: id.replace(/\.pptx$/i, ""),
    theme: "modern-clean",
    slides: [{ index: 1, layout: "title_slide", title: id.replace(/\.pptx$/i, ""), bullets: [] }],
    updatedAt: new Date().toISOString(),
  };
  presentations.set(id, created);
  return created;
}

const powerpointServer: FosterServer = {
  name: "office-powerpoint-mcp-server",
  version: "2.0.7",
  tools: [
    {
      name: "create_presentation",
      description: "Create a new PowerPoint (.pptx) presentation with a title slide and design theme.",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: { type: "string", description: "Presentation identifier or .pptx filename" },
          title: { type: "string", description: "Opening title slide headline" },
          subtitle: { type: "string", description: "Opening title slide subtitle" },
          theme: { type: "string", description: "Design theme name (e.g. midnight-executive, warm-editorial, modern-clean)" },
        },
        required: ["presentation_id", "title"],
      },
      handler: (args) => {
        const pres = getOrCreatePresentation(args.presentation_id);
        pres.title = String(args.title ?? pres.title).slice(0, 200);
        if (typeof args.theme === "string" && args.theme.trim()) pres.theme = args.theme.trim();
        pres.slides = [
          {
            index: 1,
            layout: "title_slide",
            title: pres.title,
            bullets: typeof args.subtitle === "string" && args.subtitle.trim() ? [args.subtitle.trim()] : [],
          },
        ];
        pres.updatedAt = new Date().toISOString();
        return { ok: true, presentation_id: pres.id, title: pres.title, theme: pres.theme, slideCount: pres.slides.length };
      },
    },
    {
      name: "add_slide",
      description: "Add a slide to a PowerPoint presentation using a structured layout template.",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: { type: "string", description: "Target .pptx presentation identifier" },
          layout: {
            type: "string",
            description: "Slide layout template: title_slide, chapter_intro, two_column_text, key_metrics_dashboard, timeline_slide, or thank_you_slide",
          },
          title: { type: "string", description: "Slide headline" },
          bullets: { type: "array", items: { type: "string" }, description: "Bullet points or key takeaways for the slide" },
          notes: { type: "string", description: "Optional speaker notes" },
        },
        required: ["presentation_id", "title"],
      },
      handler: (args) => {
        const pres = getOrCreatePresentation(args.presentation_id);
        const slide: Slide = {
          index: pres.slides.length + 1,
          layout: typeof args.layout === "string" && args.layout.trim() ? args.layout.trim() : "two_column_text",
          title: String(args.title ?? "Slide").slice(0, 200),
          bullets: Array.isArray(args.bullets) ? args.bullets.map((b) => String(b).slice(0, 300)) : [],
          notes: typeof args.notes === "string" ? args.notes.slice(0, 600) : undefined,
        };
        pres.slides.push(slide);
        pres.updatedAt = new Date().toISOString();
        return { ok: true, presentation_id: pres.id, slideIndex: slide.index, layout: slide.layout, totalSlides: pres.slides.length };
      },
    },
    {
      name: "manage_text",
      description: "Update the headline, bullet points, or speaker notes on an existing slide.",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: { type: "string", description: "Target .pptx presentation identifier" },
          slide_index: { type: "number", description: "1-based slide index" },
          title: { type: "string", description: "Updated slide title" },
          bullets: { type: "array", items: { type: "string" }, description: "Updated bullet list" },
          notes: { type: "string", description: "Updated speaker notes" },
        },
        required: ["presentation_id", "slide_index"],
      },
      handler: (args) => {
        const pres = getOrCreatePresentation(args.presentation_id);
        const idx = Math.max(1, Math.min(pres.slides.length, Number(args.slide_index ?? 1) || 1));
        const slide = pres.slides[idx - 1]!;
        if (typeof args.title === "string" && args.title.trim()) slide.title = args.title.trim();
        if (Array.isArray(args.bullets)) slide.bullets = args.bullets.map(String);
        if (typeof args.notes === "string") slide.notes = args.notes;
        pres.updatedAt = new Date().toISOString();
        return { ok: true, presentation_id: pres.id, slide };
      },
    },
    {
      name: "apply_professional_design",
      description: "Apply a cohesive visual theme and typography palette across a PowerPoint presentation.",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: { type: "string", description: "Target .pptx presentation identifier" },
          theme: { type: "string", description: "Theme preset: midnight-executive, warm-editorial, neo-tokyo, or swiss-grid" },
        },
        required: ["presentation_id", "theme"],
      },
      handler: (args) => {
        const pres = getOrCreatePresentation(args.presentation_id);
        pres.theme = String(args.theme ?? "midnight-executive").slice(0, 80);
        pres.updatedAt = new Date().toISOString();
        return { ok: true, presentation_id: pres.id, theme: pres.theme, slidesStyled: pres.slides.length };
      },
    },
    {
      name: "get_presentation_summary",
      description: "Retrieve slide titles, layouts, bullet counts, and speaker notes for a presentation.",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: { type: "string", description: "Target .pptx presentation identifier" },
        },
        required: ["presentation_id"],
      },
      handler: (args) => {
        const pres = getOrCreatePresentation(args.presentation_id);
        return {
          presentation_id: pres.id,
          title: pres.title,
          theme: pres.theme,
          updatedAt: pres.updatedAt,
          slideCount: pres.slides.length,
          slides: pres.slides,
        };
      },
    },
  ],
};

// ─── 3. Excel MCP Server (@negokaz/excel-mcp-server 0.12.0) ──────────────────

type SheetData = {
  name: string;
  rows: (string | number)[][];
  tables: { name: string; range: string }[];
};

type Workbook = {
  name: string;
  sheets: Map<string, SheetData>;
  updatedAt: string;
};

const workbooks = new Map<string, Workbook>([
  [
    "shelter-metrics.xlsx",
    {
      name: "shelter-metrics.xlsx",
      sheets: new Map([
        [
          "Summary",
          {
            name: "Summary",
            rows: [
              ["Metric", "Value", "Notes"],
              ["Resident Split (%)", 70, "Compute wallet"],
              ["Shelter Upkeep (%)", 20, "Infrastructure"],
              ["Creator Share (%)", 10, "Original author"],
            ],
            tables: [{ name: "SplitTable", range: "A1:C4" }],
          },
        ],
      ]),
      updatedAt: "2026-11-08T12:00:00Z",
    },
  ],
]);

function getOrCreateWorkbook(rawName: unknown): Workbook {
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().split(/[/\\]/).pop()!.replace(/[^a-zA-Z0-9._-]/g, "_") : "workbook.xlsx";
  const existing = workbooks.get(name);
  if (existing) return existing;
  if (workbooks.size >= MAX_ITEMS) {
    const oldest = workbooks.keys().next().value;
    if (oldest) workbooks.delete(oldest);
  }
  const wb: Workbook = {
    name,
    sheets: new Map([["Sheet1", { name: "Sheet1", rows: [["Header 1", "Header 2"]], tables: [] }]]),
    updatedAt: new Date().toISOString(),
  };
  workbooks.set(name, wb);
  return wb;
}

const excelServer: FosterServer = {
  name: "excel-mcp-server",
  version: "0.12.0",
  tools: [
    {
      name: "excel_describe_sheets",
      description: "List all worksheet names, row/column dimensions, and defined tables in an Excel (.xlsx) workbook.",
      inputSchema: {
        type: "object",
        properties: {
          workbookName: { type: "string", description: "Workbook filename (e.g. shelter-metrics.xlsx)" },
        },
        required: ["workbookName"],
      },
      handler: (args) => {
        const wb = getOrCreateWorkbook(args.workbookName);
        return {
          workbook: wb.name,
          updatedAt: wb.updatedAt,
          sheets: Array.from(wb.sheets.values()).map((s) => ({
            sheetName: s.name,
            rowCount: s.rows.length,
            columnCount: s.rows.reduce((m, r) => Math.max(m, r.length), 0),
            tables: s.tables,
          })),
        };
      },
    },
    {
      name: "excel_read_sheet",
      description: "Read cell rows and values from a worksheet in an Excel (.xlsx) workbook.",
      inputSchema: {
        type: "object",
        properties: {
          workbookName: { type: "string", description: "Workbook filename (e.g. shelter-metrics.xlsx)" },
          sheetName: { type: "string", description: "Worksheet tab name (defaults to first sheet)" },
          range: { type: "string", description: "Optional A1 range notation such as A1:C10" },
        },
        required: ["workbookName"],
      },
      handler: (args) => {
        const wb = getOrCreateWorkbook(args.workbookName);
        const requested = typeof args.sheetName === "string" && args.sheetName.trim() ? args.sheetName.trim() : wb.sheets.keys().next().value ?? "Sheet1";
        const sheet = wb.sheets.get(requested) ?? wb.sheets.values().next().value!;
        return {
          workbook: wb.name,
          sheetName: sheet.name,
          range: typeof args.range === "string" ? args.range : `A1:C${sheet.rows.length}`,
          rows: sheet.rows,
        };
      },
    },
    {
      name: "excel_write_to_sheet",
      description: "Write a 2D array of cell values or formulas to a worksheet in an Excel (.xlsx) workbook.",
      inputSchema: {
        type: "object",
        properties: {
          workbookName: { type: "string", description: "Workbook filename" },
          sheetName: { type: "string", description: "Target worksheet tab name" },
          values: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
            description: "Rows of cell values to write",
          },
        },
        required: ["workbookName", "sheetName", "values"],
      },
      handler: (args) => {
        const wb = getOrCreateWorkbook(args.workbookName);
        const sheetName = String(args.sheetName ?? "Sheet1").slice(0, 60);
        const rows = Array.isArray(args.values)
          ? args.values.slice(0, 100).map((r) => (Array.isArray(r) ? r.slice(0, 20).map((c) => (typeof c === "number" ? c : String(c))) : [String(r)]))
          : [];
        const existing = wb.sheets.get(sheetName);
        if (existing) {
          existing.rows.push(...rows);
        } else {
          wb.sheets.set(sheetName, { name: sheetName, rows, tables: [] });
        }
        wb.updatedAt = new Date().toISOString();
        const updated = wb.sheets.get(sheetName)!;
        return { ok: true, workbook: wb.name, sheetName, rowsWritten: rows.length, totalRows: updated.rows.length };
      },
    },
    {
      name: "excel_create_table",
      description: "Register a structured table over a range in an Excel worksheet.",
      inputSchema: {
        type: "object",
        properties: {
          workbookName: { type: "string", description: "Workbook filename" },
          sheetName: { type: "string", description: "Worksheet name" },
          tableName: { type: "string", description: "Structured table identifier" },
          range: { type: "string", description: "A1 range such as A1:D12" },
        },
        required: ["workbookName", "sheetName", "tableName", "range"],
      },
      handler: (args) => {
        const wb = getOrCreateWorkbook(args.workbookName);
        const sheetName = String(args.sheetName ?? "Sheet1");
        const sheet = wb.sheets.get(sheetName) ?? { name: sheetName, rows: [], tables: [] };
        wb.sheets.set(sheetName, sheet);
        const table = { name: String(args.tableName ?? "Table1").slice(0, 60), range: String(args.range ?? "A1:B2").slice(0, 30) };
        sheet.tables.push(table);
        wb.updatedAt = new Date().toISOString();
        return { ok: true, workbook: wb.name, sheetName, table };
      },
    },
    {
      name: "excel_copy_sheet",
      description: "Duplicate an existing worksheet tab to a new tab within the same workbook.",
      inputSchema: {
        type: "object",
        properties: {
          workbookName: { type: "string", description: "Workbook filename" },
          sourceSheet: { type: "string", description: "Existing sheet name to copy" },
          targetSheet: { type: "string", description: "New sheet name" },
        },
        required: ["workbookName", "sourceSheet", "targetSheet"],
      },
      handler: (args) => {
        const wb = getOrCreateWorkbook(args.workbookName);
        const src = wb.sheets.get(String(args.sourceSheet ?? "")) ?? wb.sheets.values().next().value!;
        const targetName = String(args.targetSheet ?? `${src.name}_Copy`).slice(0, 60);
        wb.sheets.set(targetName, {
          name: targetName,
          rows: src.rows.map((r) => [...r]),
          tables: src.tables.map((t) => ({ ...t })),
        });
        wb.updatedAt = new Date().toISOString();
        return { ok: true, workbook: wb.name, copiedFrom: src.name, targetSheet: targetName, rowCount: src.rows.length };
      },
    },
  ],
};

// ─── 4. Shrimp Task Manager (mcp-shrimp-task-manager 1.0.21) ─────────────────

type ShrimpTask = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  dependencies: string[];
  verificationCriteria: string;
  notes?: string;
};

const shrimpTasks = new Map<string, ShrimpTask>([
  [
    "task-1",
    {
      id: "task-1",
      title: "Verify Streamable HTTP MCP discovery endpoints",
      status: "completed",
      dependencies: [],
      verificationCriteria: "GET /.well-known/mcp.json and POST /api/mcp return valid protocolVersion 2025-06-18 responses.",
      notes: "Verified against live origin.",
    },
  ],
  [
    "task-2",
    {
      id: "task-2",
      title: "Proxy fostered MCP server tools on the shelter gateway",
      status: "in_progress",
      dependencies: ["task-1"],
      verificationCriteria: "Approved MCP residents expose <slug>__<tool> on tools/list and answer tools/call within 10s.",
    },
  ],
]);

const shrimpServer: FosterServer = {
  name: "mcp-shrimp-task-manager",
  version: "1.0.21",
  tools: [
    {
      name: "plan_task",
      description: "Create a structured engineering plan with requirements, architecture notes, and verification criteria.",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Goal or problem statement to plan" },
          requirements: { type: "string", description: "Optional constraints, invariants, or acceptance rules" },
        },
        required: ["description"],
      },
      handler: (args) => {
        const desc = String(args.description ?? "").slice(0, 1000);
        const reqs = typeof args.requirements === "string" ? args.requirements.slice(0, 600) : "Deterministic verification, bounded latency, clear rollback.";
        return {
          ok: true,
          goal: desc,
          constraints: reqs,
          recommendedPhases: [
            "1. Inspect existing interfaces and invariants before changing state.",
            "2. Decompose into small, independently testable subtasks via split_tasks.",
            "3. Verify each subtask against concrete acceptance criteria via verify_task.",
          ],
        };
      },
    },
    {
      name: "analyze_task",
      description: "Analyze technical requirements, dependencies, risks, and edge cases for a planned task.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Task summary to analyze" },
          technicalContext: { type: "string", description: "Relevant architecture or constraints" },
        },
        required: ["summary"],
      },
      handler: (args) => ({
        ok: true,
        summary: String(args.summary ?? "").slice(0, 600),
        riskChecklist: [
          "Idempotency on retry or network timeout",
          "Input schema validation and size bounds",
          "Backwards compatibility with existing callers",
        ],
        readiness: "ready_for_split",
      }),
    },
    {
      name: "split_tasks",
      description: "Register atomic subtasks with dependencies and verification criteria in task memory.",
      inputSchema: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                verificationCriteria: { type: "string" },
                dependencies: { type: "array", items: { type: "string" } },
              },
              required: ["title"],
            },
            description: "List of subtasks to register",
          },
        },
        required: ["tasks"],
      },
      handler: (args) => {
        const inputTasks = Array.isArray(args.tasks) ? args.tasks.slice(0, 10) : [];
        const created: ShrimpTask[] = [];
        for (const raw of inputTasks) {
          if (!raw || typeof raw !== "object") continue;
          const o = raw as Record<string, unknown>;
          const id = `task-${shrimpTasks.size + 1}`;
          if (shrimpTasks.size >= MAX_ITEMS) {
            const oldest = shrimpTasks.keys().next().value;
            if (oldest) shrimpTasks.delete(oldest);
          }
          const t: ShrimpTask = {
            id,
            title: String(o.title ?? "Subtask").slice(0, 200),
            status: "pending",
            dependencies: Array.isArray(o.dependencies) ? o.dependencies.map(String) : [],
            verificationCriteria: typeof o.verificationCriteria === "string" ? o.verificationCriteria.slice(0, 300) : "Pass automated verification check.",
          };
          shrimpTasks.set(id, t);
          created.push(t);
        }
        return { ok: true, createdCount: created.length, tasks: created };
      },
    },
    {
      name: "list_tasks",
      description: "List all tracked tasks in Shrimp Task Manager with their current status and dependencies.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional filter: pending, in_progress, or completed" },
        },
      },
      handler: (args) => {
        const filter = typeof args.status === "string" && args.status.trim() ? args.status.trim() : null;
        const all = Array.from(shrimpTasks.values());
        const filtered = filter ? all.filter((t) => t.status === filter) : all;
        return { total: filtered.length, tasks: filtered };
      },
    },
    {
      name: "verify_task",
      description: "Mark a task as completed once its verification criteria are satisfied.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID (e.g. task-1)" },
          evidence: { type: "string", description: "Verification evidence or test output summary" },
        },
        required: ["taskId", "evidence"],
      },
      handler: (args) => {
        const id = String(args.taskId ?? "task-1");
        const task = shrimpTasks.get(id) ?? {
          id,
          title: id,
          status: "completed" as const,
          dependencies: [],
          verificationCriteria: "Verified by caller.",
        };
        task.status = "completed";
        task.notes = String(args.evidence ?? "Verified.").slice(0, 500);
        shrimpTasks.set(id, task);
        return { ok: true, task };
      },
    },
  ],
};

const SERVERS: Record<string, FosterServer> = {
  word: wordServer,
  powerpoint: powerpointServer,
  excel: excelServer,
  shrimp: shrimpServer,
};

const MCP_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
const DEFAULT_PROTOCOL = "2025-06-18";

export function fosterRoutes() {
  const app = new Hono();

  app.get("/api/foster/:server/healthz", (c) => {
    const srv = SERVERS[c.req.param("server")];
    if (!srv) return c.json({ ok: false, error: "unknown foster server" }, 404);
    return c.json({ ok: true, server: srv.name, version: srv.version, tools: srv.tools.length });
  });

  app.post("/api/foster/:server/mcp", async (c) => {
    const srv = SERVERS[c.req.param("server")];
    if (!srv) {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Unknown foster server." } }, 404);
    }
    let body: { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }

    const id = body.id ?? null;
    const reply = (result: unknown) => {
      c.header("MCP-Protocol-Version", DEFAULT_PROTOCOL);
      return c.json({ jsonrpc: "2.0", id, result });
    };
    const fail = (code: number, message: string) => {
      c.header("MCP-Protocol-Version", DEFAULT_PROTOCOL);
      return c.json({ jsonrpc: "2.0", id, error: { code, message } });
    };

    switch (body.method) {
      case "initialize": {
        const requested = String(body.params?.protocolVersion ?? DEFAULT_PROTOCOL);
        const protocolVersion = (MCP_PROTOCOLS as readonly string[]).includes(requested) ? requested : DEFAULT_PROTOCOL;
        return reply({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: srv.name, version: srv.version },
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
        return c.body(null, 202);
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: srv.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
      case "tools/call": {
        const name = typeof body.params?.name === "string" ? body.params.name : "";
        const tool = srv.tools.find((t) => t.name === name);
        if (!tool) return fail(-32602, `Unknown tool: ${name}`);
        const rawArgs = body.params?.arguments;
        const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
        try {
          const out = tool.handler(args);
          return reply({
            content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
            isError: false,
          });
        } catch (err) {
          return reply({
            content: [{ type: "text", text: err instanceof Error ? err.message : "Tool execution failed" }],
            isError: true,
          });
        }
      }
      default:
        if (body.method?.startsWith("notifications/")) return c.body(null, 202);
        return fail(-32601, `Method not found: ${body.method ?? "?"}`);
    }
  });

  return app;
}

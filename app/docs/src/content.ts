import { slugify } from "@/lib/utils";

export type DocSection = "technical" | "reference" | "plans";

export interface DocHeading {
  level: number;
  text: string;
  id: string;
}

export interface DocEntry {
  id: string;
  section: DocSection;
  title: string;
  slug: string;
  route: string;
  summary: string;
  markdown: string;
  headings: DocHeading[];
  sourcePath: string;
  order: number;
}

function extractTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  const title = match?.[1];
  return title ? title.trim() : fallback;
}

function extractSummary(markdown: string): string {
  const lines = markdown.split("\n");
  let seenTitle = false;
  let bucket: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!seenTitle) {
      if (trimmed.startsWith("# ")) {
        seenTitle = true;
      }
      continue;
    }
    if (!trimmed) {
      if (bucket.length) break;
      continue;
    }
    if (trimmed.startsWith("#")) {
      if (bucket.length) break;
      continue;
    }
    bucket.push(trimmed);
    if (bucket.join(" ").length > 180) break;
  }
  return bucket.join(" ") || "Technical reference for this part of Crate.";
}

function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();
  for (const line of markdown.split("\n")) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const hashes = match[1];
    const rawText = match[2];
    if (!hashes || !rawText) continue;
    const text = rawText.trim();
    const baseId = slugify(text);
    const dup = seen.get(baseId) ?? 0;
    seen.set(baseId, dup + 1);
    headings.push({
      level: hashes.length,
      text,
      id: dup === 0 ? baseId : `${baseId}-${dup + 1}`,
    });
  }
  return headings;
}

function sortByNumericPrefix(path: string): number {
  const match = path.match(/\/(\d+)-/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

const technicalModules = import.meta.glob("../../../docs/technical/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const referenceModules = import.meta.glob("../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const planModules = import.meta.glob("../../../docs/plans/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function technicalDocs(): DocEntry[] {
  return Object.entries(technicalModules)
    .map(([path, markdown]) => {
      const file = path.split("/").pop() || "document";
      const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
      const title = extractTitle(markdown, slug);
      return {
        id: `technical:${slug}`,
        section: "technical" as const,
        title,
        slug,
        route: `/technical/${slug}`,
        summary: extractSummary(markdown),
        markdown,
        headings: extractHeadings(markdown),
        sourcePath: path.replace("../../../", ""),
        order: sortByNumericPrefix(path),
      };
    })
    .sort((a, b) => a.order - b.order);
}

function referenceDocs(): DocEntry[] {
  return Object.entries(referenceModules)
    .filter(([path]) => !path.includes("/technical/") && !path.includes("/plans/"))
    .map(([path, markdown]) => {
      const file = path.split("/").pop() || "document";
      const slug = file.replace(/\.md$/, "").toLowerCase();
      const title = extractTitle(markdown, slug);
      return {
        id: `reference:${slug}`,
        section: "reference" as const,
        title,
        slug,
        route: `/reference/${slug}`,
        summary: extractSummary(markdown),
        markdown,
        headings: extractHeadings(markdown),
        sourcePath: path.replace("../../../", ""),
        order: slug === "readme" ? 0 : 100,
      };
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function planDocs(): DocEntry[] {
  return Object.entries(planModules)
    .map(([path, markdown]) => {
      const file = path.split("/").pop() || "document";
      const slug = file.replace(/\.md$/, "");
      const title = extractTitle(markdown, slug);
      return {
        id: `plans:${slug}`,
        section: "plans" as const,
        title,
        slug,
        route: `/plans/${slug}`,
        summary: extractSummary(markdown),
        markdown,
        headings: extractHeadings(markdown),
        sourcePath: path.replace("../../../", ""),
        order: 0,
      };
    })
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

export const docs: DocEntry[] = [
  ...technicalDocs(),
  ...referenceDocs(),
  ...planDocs(),
];

export const docsBySection: Record<DocSection, DocEntry[]> = {
  technical: docs.filter((doc) => doc.section === "technical"),
  reference: docs.filter((doc) => doc.section === "reference"),
  plans: docs.filter((doc) => doc.section === "plans"),
};

export const sectionMeta: Record<DocSection, { label: string; description: string }> = {
  technical: {
    label: "Technical",
    description: "Long-lived architecture and subsystem documentation for Crate as it exists today.",
  },
  reference: {
    label: "Reference",
    description: "Entry-point docs and focused references that still matter day to day.",
  },
  plans: {
    label: "Plans",
    description: "Historical and active design notes, roadmaps, and implementation plans.",
  },
};

export function getDoc(section: string | undefined, slug: string | undefined): DocEntry | undefined {
  return docs.find((doc) => doc.section === section && doc.slug === slug);
}

export function getAdjacentDocs(doc: DocEntry): { previous?: DocEntry; next?: DocEntry } {
  const inSection = docsBySection[doc.section];
  const index = inSection.findIndex((entry) => entry.id === doc.id);
  return {
    previous: index > 0 ? inSection[index - 1] : undefined,
    next: index >= 0 && index < inSection.length - 1 ? inSection[index + 1] : undefined,
  };
}

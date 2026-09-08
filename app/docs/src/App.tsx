import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Code2,
  FileText,
  Home,
  Layers3,
  Menu,
  Network,
  Rocket,
  Search,
} from "lucide-react";

import { MarkdownArticle } from "@/components/MarkdownArticle";
import {
  docsBySection,
  getAdjacentDocs,
  getDoc,
  loadDoc,
  sectionMeta,
  sourceUrl,
  type DocEntry,
  type DocHeading,
  type DocSection,
  type LoadedDoc,
} from "@/content";
import { cn } from "@/lib/utils";

const navItems: Array<{ label: string; to: string }> = [
  { label: "Overview", to: "/" },
  { label: "Developer", to: "/developer" },
  { label: "Operations", to: "/operations" },
  { label: "Federation", to: "/federation" },
  { label: "Reference", to: "/reference" },
];

function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-cyan-200/12 bg-[#050507]/94 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-5 sm:px-8">
        <button
          onClick={onMenu}
          className="inline-flex h-9 w-9 items-center justify-center border border-white/12 bg-transparent text-white/62 transition hover:border-cyan-200/28 hover:text-white lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <Link to="/" className="flex items-center gap-3">
          <img src="/icons/logo.svg" alt="Crate" className="h-7 w-7 shrink-0" />
          <div>
            <div className="font-mono text-[12px] uppercase text-cyan-200">
              Crate Docs
            </div>
            <div className="hidden font-mono text-[11px] uppercase text-white/34 sm:block">
              Developer / operations / federation
            </div>
          </div>
        </Link>
        <nav className="ml-auto hidden items-center gap-5 lg:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "font-mono text-[12px] uppercase underline decoration-white/16 underline-offset-4 transition",
                  isActive
                    ? "text-cyan-200 decoration-cyan-200/45"
                    : "text-white/50 hover:text-white",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

function SectionIcon({ section }: { section: DocSection }) {
  switch (section) {
    case "start":
      return <Rocket size={18} />;
    case "architecture":
      return <Layers3 size={18} />;
    case "developer":
      return <Code2 size={18} />;
    case "operations":
      return <Activity size={18} />;
    case "federation":
      return <Network size={18} />;
    case "reference":
      return <BookOpen size={18} />;
  }
}

function Sidebar({
  open,
  onClose,
  query,
  onQueryChange,
  searchRef,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return docsBySection;

    return (Object.keys(docsBySection) as DocSection[]).reduce(
      (result, section) => {
        result[section] = docsBySection[section].filter((doc) =>
          `${doc.title} ${doc.summary} ${doc.keywords.join(" ")}`
            .toLowerCase()
            .includes(term),
        );
        return result;
      },
      {} as Record<DocSection, DocEntry[]>,
    );
  }, [query]);

  return (
    <>
      <button
        type="button"
        className={cn(
          "fixed inset-0 z-20 border-0 bg-black/68 p-0 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-label="Close navigation"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-[320px] border-r border-cyan-200/12 bg-[#050507]/96 p-5 transition-transform lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-4">
          <div className="mb-2 font-mono text-[12px] uppercase text-cyan-200">
            Navigation index
          </div>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cyan-200/42"
            />
            <label htmlFor="docs-search" className="sr-only">
              Search documentation
            </label>
            <input
              ref={searchRef}
              id="docs-search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search docs"
              className="h-11 w-full border border-cyan-200/16 bg-[#061014]/36 pl-10 pr-3 font-mono text-[13px] text-white outline-none placeholder:text-white/30 focus:border-cyan-200/52"
            />
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 border border-white/10 bg-black/18 px-2 py-1 font-mono text-[11px] text-white/35">
              /
            </div>
          </div>
        </div>

        <nav className="hide-rail-scrollbar h-[calc(100%-5.5rem)] overflow-y-auto pr-1">
          {(Object.keys(filtered) as DocSection[]).map((section) => {
            const items = filtered[section];
            if (!items.length) return null;
            return (
              <div key={section} className="mb-6">
                <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase text-white/38">
                  <SectionIcon section={section} />
                  <span>{sectionMeta[section].label}</span>
                </div>
                <div className="space-y-px">
                  {items.map((doc) => (
                    <NavLink
                      key={doc.id}
                      to={doc.route}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          "block border-l px-3 py-2.5 transition",
                          isActive
                            ? "border-cyan-200 bg-[#061014]/54 text-white"
                            : "border-white/10 text-white/62 hover:border-cyan-200/38 hover:bg-white/[0.025] hover:text-white",
                        )
                      }
                    >
                      <div className="text-sm font-medium leading-tight">
                        {doc.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-white/38">
                        {doc.summary}
                      </div>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function DocCard({ doc, label }: { doc: DocEntry; label: string }) {
  return (
    <Link
      to={doc.route}
      className="group border border-white/10 bg-white/[0.018] p-6 transition hover:border-cyan-200/30 hover:bg-[#061014]/34"
    >
      <div className="mb-3 font-mono text-[12px] uppercase text-cyan-200/88">
        {label}
      </div>
      <div className="text-xl font-semibold text-white">{doc.title}</div>
      <p className="mt-2 text-sm leading-6 text-white/58">{doc.summary}</p>
      <div className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-200">
        <span className="font-mono text-[12px] uppercase underline decoration-cyan-200/35 underline-offset-4">
          Read document
        </span>
        <ArrowRight
          size={16}
          className="transition group-hover:translate-x-1"
        />
      </div>
    </Link>
  );
}

function HomePage() {
  const systemOverview = getDoc("architecture", "system-overview");
  const readingPath = [
    docsBySection.start[0],
    systemOverview,
    docsBySection.developer[0],
    docsBySection.operations[0],
    docsBySection.federation[0],
  ].filter((doc): doc is DocEntry => Boolean(doc));

  return (
    <div className="space-y-10">
      <section className="border-y border-cyan-200/16 bg-[#061014]/28 p-7 sm:p-10">
        <div className="max-w-3xl">
          <div className="mb-5 font-mono text-[12px] uppercase text-cyan-200">
            Crate Documentation
          </div>
          <h1 className="max-w-[14ch] text-[48px] font-extrabold uppercase leading-[0.9] text-white [text-shadow:0_0_34px_rgba(103,232,249,0.12)] sm:text-[76px]">
            The technical field guide for a self-hosted music platform.
          </h1>
          <p className="mt-6 max-w-3xl text-[17px] leading-8 text-white/66 sm:text-[20px] sm:leading-9">
            Use the right path for local development, a single home instance or
            project-hosted image-first deployment. Federation is documented as a
            controlled node-to-node capability, not anonymous public peering.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4 py-2">
            {systemOverview ? (
              <Link
                to={systemOverview.route}
                className="font-mono text-[13px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
              >
                Start with the system overview
              </Link>
            ) : null}
            <a
              href="https://github.com/thecrateapp/crate"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[13px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
            >
              Source on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(sectionMeta) as DocSection[]).map((section) => {
          const entry = docsBySection[section][0];
          return (
            <div
              key={section}
              className="border border-cyan-200/14 bg-[#061014]/28 p-6"
            >
              <div className="mb-3 flex items-center gap-2 text-cyan-300">
                <SectionIcon section={section} />
                <span className="font-mono text-[12px] uppercase">
                  {sectionMeta[section].label}
                </span>
              </div>
              <p className="text-sm leading-6 text-white/65">
                {sectionMeta[section].description}
              </p>
              {entry ? (
                <Link
                  to={`/${section}`}
                  className="mt-5 inline-flex font-mono text-[12px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4 transition hover:text-cyan-100"
                >
                  View all
                </Link>
              ) : null}
            </div>
          );
        })}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2 font-mono text-[12px] uppercase text-white/45">
          <FileText size={16} />
          Canonical reading paths
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {readingPath.map((doc, index) => (
            <DocCard
              key={doc.id}
              doc={doc}
              label={`Step ${String(index + 1).padStart(2, "0")}`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionPage() {
  const { section } = useParams();
  if (!section || !(section in docsBySection))
    return <Navigate to="/" replace />;

  const typedSection = section as DocSection;
  const entries = docsBySection[typedSection];
  const meta = sectionMeta[typedSection];

  return (
    <div className="space-y-6">
      <section className="border-y border-cyan-200/16 bg-[#061014]/28 p-7 sm:p-8">
        <div className="mb-4 inline-flex items-center gap-2 font-mono text-[12px] uppercase text-cyan-200">
          <SectionIcon section={typedSection} />
          {meta.label}
        </div>
        <h1 className="max-w-3xl text-[42px] font-extrabold uppercase leading-[0.95] text-white sm:text-[64px]">
          {meta.label} documentation
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/62 sm:text-base">
          {meta.description}
        </p>
        <div className="mt-5 font-mono text-[12px] uppercase text-white/35">
          {entries.length} documents in this section
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {entries.map((doc) => (
          <DocCard key={doc.id} doc={doc} label={meta.label} />
        ))}
      </div>
    </div>
  );
}

function TableOfContents({ headings }: { headings: DocHeading[] }) {
  if (!headings.length) return null;
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-24 border-l border-cyan-200/18 p-5">
        <div className="mb-3 font-mono text-[12px] uppercase text-white/45">
          On this page
        </div>
        <nav className="space-y-2">
          {headings.map((heading) => (
            <a
              key={`${heading.level}-${heading.id}`}
              href={`#${heading.id}`}
              className={cn(
                "docs-toc-link block text-sm leading-5 text-white/55 transition hover:text-cyan-200",
                heading.level > 2 && "pl-3 text-white/42",
              )}
            >
              {heading.text}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}

function LoadedDocument({ doc }: { doc: DocEntry }) {
  const [loaded, setLoaded] = useState<LoadedDoc>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    let active = true;
    setLoaded(undefined);
    setError(undefined);

    void loadDoc(doc).then(
      (value) => {
        if (active) setLoaded(value);
      },
      (reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason
              : new Error("Unable to load document."),
          );
        }
      },
    );

    return () => {
      active = false;
    };
  }, [doc]);

  const adjacent = getAdjacentDocs(doc);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
      <article className="min-w-0">
        <div className="border-y border-white/10 bg-[#050507]/58 p-6 sm:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 font-mono text-[12px] uppercase text-cyan-200">
              <SectionIcon section={doc.section} />
              {sectionMeta[doc.section].label}
            </div>
            <a
              href={sourceUrl(doc.sourcePath)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] text-white/45 underline decoration-white/20 underline-offset-4 hover:text-cyan-200"
            >
              View source
            </a>
          </div>
          {error ? (
            <div className="border border-red-300/30 bg-red-300/5 p-4 text-sm text-red-100">
              {error.message}
            </div>
          ) : loaded ? (
            <MarkdownArticle
              markdown={loaded.markdown}
              sourcePath={doc.sourcePath}
            />
          ) : (
            <div className="py-16 font-mono text-[12px] uppercase text-white/40">
              Loading document…
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {adjacent.previous ? (
            <Link
              to={adjacent.previous.route}
              className="border border-white/10 bg-white/[0.018] p-5 transition hover:border-cyan-200/30"
            >
              <div className="mb-2 flex items-center gap-2 font-mono text-[12px] uppercase text-white/40">
                <ArrowLeft size={14} />
                Previous
              </div>
              <div className="text-base font-medium text-white">
                {adjacent.previous.title}
              </div>
            </Link>
          ) : (
            <div />
          )}
          {adjacent.next ? (
            <Link
              to={adjacent.next.route}
              className="border border-white/10 bg-white/[0.018] p-5 transition hover:border-cyan-200/30"
            >
              <div className="mb-2 flex items-center justify-end gap-2 font-mono text-[12px] uppercase text-white/40">
                Next
                <ArrowRight size={14} />
              </div>
              <div className="text-base font-medium text-white">
                {adjacent.next.title}
              </div>
            </Link>
          ) : null}
        </div>
      </article>

      <TableOfContents headings={loaded?.headings ?? []} />
    </div>
  );
}

function DocPage() {
  const params = useParams();
  const doc = getDoc(params.section, params.slug);
  if (!doc) return <Navigate to="/" replace />;

  return <LoadedDocument doc={doc} />;
}

function NotFoundPage() {
  return (
    <div className="border-y border-white/10 bg-white/[0.018] p-10 text-center">
      <div className="font-mono text-[12px] uppercase text-white/35">
        Not found
      </div>
      <h1 className="mt-3 text-3xl font-extrabold uppercase text-white">
        This documentation page does not exist.
      </h1>
      <Link
        to="/"
        className="mt-6 inline-flex font-mono text-[12px] uppercase text-cyan-200 underline decoration-cyan-200/35 underline-offset-4"
      >
        Back to docs home
      </Link>
    </div>
  );
}

function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);

  if (!parts.length) {
    return (
      <div className="mb-5 flex items-center gap-2 font-mono text-[12px] uppercase text-white/32">
        <Home size={14} />
        Documentation home
      </div>
    );
  }

  const labels = parts.map((part, index) => {
    if (index === 0 && part in sectionMeta) {
      return sectionMeta[part as DocSection].label;
    }
    return part.replace(/-/g, " ");
  });

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 font-mono text-[12px] uppercase text-white/32">
      <Home size={14} />
      {labels.map((label) => (
        <div key={label} className="flex items-center gap-2">
          <ChevronRight size={12} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable)
        return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="docs-shell min-h-screen bg-app-surface text-white">
      <Header onMenu={() => setMenuOpen(true)} />
      <div className="mx-auto grid max-w-[1600px] gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Sidebar
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
        />
        <main className="min-w-0 px-5 py-6 sm:px-8 lg:py-8">
          <Breadcrumbs />
          <Routes>
            <Route index element={<HomePage />} />
            <Route path=":section" element={<SectionPage />} />
            <Route path=":section/:slug" element={<DocPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

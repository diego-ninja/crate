import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileText,
  Home,
  Layers3,
  Menu,
  Search,
  Sparkles,
} from "lucide-react";

import { MarkdownArticle } from "@/components/MarkdownArticle";
import { docs, docsBySection, getAdjacentDocs, getDoc, sectionMeta, type DocEntry, type DocSection } from "@/content";
import { cn } from "@/lib/utils";

function Header({ onMenu }: { onMenu: () => void }) {
  const navItems: Array<{ label: string; to: string }> = [
    { label: "Overview", to: "/" },
    { label: "Technical", to: "/technical" },
    { label: "Reference", to: "/reference" },
    { label: "Plans", to: "/plans" },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[rgba(10,10,15,0.82)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/5 text-white/70 transition hover:bg-white/10 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <Link to="/" className="flex items-center gap-3">
          <img src="/icons/logo.svg" alt="Crate" className="h-9 w-9 shrink-0" />
          <div>
            <div className="text-sm font-semibold tracking-[0.12em] text-cyan-300 uppercase">Crate Docs</div>
            <div className="text-xs text-white/45">Technical architecture and product internals</div>
          </div>
        </Link>
        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "rounded-full px-3 py-2 text-sm transition",
                  isActive ? "bg-cyan-400/12 text-cyan-200" : "text-white/55 hover:bg-white/6 hover:text-white",
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
  if (section === "technical") return <Layers3 size={18} />;
  if (section === "reference") return <BookOpen size={18} />;
  return <Sparkles size={18} />;
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
    const q = query.trim().toLowerCase();
    if (!q) return docsBySection;
    return {
      technical: docsBySection.technical.filter((doc) => `${doc.title} ${doc.summary}`.toLowerCase().includes(q)),
      reference: docsBySection.reference.filter((doc) => `${doc.title} ${doc.summary}`.toLowerCase().includes(q)),
      plans: docsBySection.plans.filter((doc) => `${doc.title} ${doc.summary}`.toLowerCase().includes(q)),
    };
  }, [query]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-20 bg-black/50 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-[320px] border-r border-white/8 bg-[#0d0f15] p-5 transition-transform lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Navigation</div>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search docs"
              className="h-11 w-full rounded-xl border border-white/8 bg-white/5 pl-10 pr-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/60"
            />
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/8 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/35">
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
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
                  <SectionIcon section={section} />
                  <span>{sectionMeta[section].label}</span>
                </div>
                <div className="space-y-1">
                  {items.map((doc) => (
                    <NavLink
                      key={doc.id}
                      to={doc.route}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          "block rounded-xl px-3 py-2.5 transition",
                          isActive ? "bg-cyan-400/12 text-white" : "text-white/65 hover:bg-white/5 hover:text-white",
                        )
                      }
                    >
                      <div className="text-sm font-medium leading-tight">{doc.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-white/38">{doc.summary}</div>
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

function HomePage() {
  const technical = docsBySection.technical.slice(0, 5);
  return (
    <div className="space-y-10">
      <section className="overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_35%),linear-gradient(180deg,rgba(15,23,42,0.7),rgba(10,10,15,0.92))] p-8 sm:p-10">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
            <Sparkles size={14} />
            Docs platform
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Crate technical documentation, now as a real product surface.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
            This site renders the source markdown from the repository and wraps it in the same visual language as Listen:
            cyan accent, dark surfaces, strong navigation, and a structure that is easier to browse than raw files alone.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-white/55">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{docs.length} documents indexed</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{docsBySection.technical.length} technical references</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{docsBySection.plans.length} plans</span>
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-cyan-200">docs.cratemusic.app</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">docs.dev.cratemusic.app</span>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        {(Object.keys(sectionMeta) as DocSection[]).map((section) => {
          const entry = docsBySection[section][0];
          return (
            <div key={section} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-6">
              <div className="mb-3 flex items-center gap-2 text-cyan-300">
                <SectionIcon section={section} />
                <span className="text-sm font-semibold uppercase tracking-[0.14em]">{sectionMeta[section].label}</span>
              </div>
              <p className="text-sm leading-6 text-white/65">{sectionMeta[section].description}</p>
              {entry ? (
                <Link
                  to={`/${section}`}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/16"
                >
                  View all
                  <ArrowRight size={16} />
                </Link>
              ) : null}
            </div>
          );
        })}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-white/45">
          <FileText size={16} />
          Reading path
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {technical.map((doc, index) => (
            <Link
              key={doc.id}
              to={doc.route}
              className="group rounded-[24px] border border-white/8 bg-white/[0.03] p-6 transition hover:border-cyan-400/25 hover:bg-white/[0.05]"
            >
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Step {index + 1}
              </div>
              <div className="text-xl font-semibold text-white">{doc.title}</div>
              <p className="mt-2 text-sm leading-6 text-white/58">{doc.summary}</p>
              <div className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-200">
                Read document
                <ArrowRight size={16} className="transition group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionPage() {
  const { section } = useParams();
  if (!section || !(section in docsBySection)) return <Navigate to="/" replace />;
  const typedSection = section as DocSection;
  const entries = docsBySection[typedSection];
  const meta = sectionMeta[typedSection];

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-7 sm:p-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
          <SectionIcon section={typedSection} />
          {meta.label}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{meta.label} documentation</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/62 sm:text-base">{meta.description}</p>
        <div className="mt-4 text-xs uppercase tracking-[0.16em] text-white/35">{entries.length} documents in this section</div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {entries.map((doc) => (
          <Link
            key={doc.id}
            to={doc.route}
            className="group rounded-[24px] border border-white/8 bg-white/[0.03] p-6 transition hover:border-cyan-400/25 hover:bg-white/[0.05]"
          >
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">{meta.label}</div>
            <div className="text-xl font-semibold text-white">{doc.title}</div>
            <p className="mt-2 text-sm leading-6 text-white/58">{doc.summary}</p>
            <div className="mt-4 inline-flex items-center gap-2 text-sm text-cyan-200">
              Read document
              <ArrowRight size={16} className="transition group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function TableOfContents({ doc }: { doc: DocEntry }) {
  if (!doc.headings.length) return null;
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-24 rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/45">On this page</div>
        <nav className="space-y-2">
          {doc.headings.map((heading) => (
            <a
              key={`${heading.level}-${heading.id}`}
              href={`#${heading.id}`}
              className={cn(
                "block text-sm leading-5 text-white/55 transition hover:text-cyan-200",
                heading.level === 3 && "pl-3 text-white/42",
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

function DocPage() {
  const params = useParams();
  const doc = getDoc(params.section, params.slug);

  if (!doc) return <Navigate to="/" replace />;

  const adjacent = getAdjacentDocs(doc);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
      <article className="min-w-0">
        <div className="mb-6 rounded-[24px] border border-white/8 bg-white/[0.03] p-6 sm:p-7">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
            <SectionIcon section={doc.section} />
            {sectionMeta[doc.section].label}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{doc.title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/62 sm:text-base">{doc.summary}</p>
          <div className="mt-4 text-xs text-white/35">Source: {doc.sourcePath}</div>
        </div>

        <div className="rounded-[28px] border border-white/8 bg-white/[0.025] p-6 sm:p-8">
          <MarkdownArticle markdown={doc.markdown} />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {adjacent.previous ? (
            <Link to={adjacent.previous.route} className="rounded-[20px] border border-white/8 bg-white/[0.03] p-5 transition hover:border-cyan-400/25">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/40">
                <ArrowLeft size={14} />
                Previous
              </div>
              <div className="text-base font-medium text-white">{adjacent.previous.title}</div>
            </Link>
          ) : <div />}
          {adjacent.next ? (
            <Link to={adjacent.next.route} className="rounded-[20px] border border-white/8 bg-white/[0.03] p-5 transition hover:border-cyan-400/25">
              <div className="mb-2 flex items-center justify-end gap-2 text-xs uppercase tracking-[0.16em] text-white/40">
                Next
                <ArrowRight size={14} />
              </div>
              <div className="text-base font-medium text-white">{adjacent.next.title}</div>
            </Link>
          ) : null}
        </div>
      </article>

      <TableOfContents doc={doc} />
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-10 text-center">
      <div className="text-sm uppercase tracking-[0.18em] text-white/35">Not found</div>
      <h1 className="mt-3 text-3xl font-semibold text-white">This documentation page does not exist.</h1>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200"
      >
        Back to docs home
      </Link>
    </div>
  );
}

function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);

  if (parts.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/32">
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
    <div className="mb-5 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/32">
      <Home size={14} />
      {labels.map((label, index) => (
        <div key={`${label}-${index}`} className="flex items-center gap-2">
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
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-app-surface text-white">
      <Header onMenu={() => setMenuOpen(true)} />
      <div className="mx-auto grid max-w-[1600px] gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Sidebar
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
        />
        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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

import { Check, Minus } from "lucide-react";

interface Row {
  label: string;
  crate: boolean | "partial";
  navidrome: boolean | "partial";
  plex: boolean | "partial";
  jellyfin: boolean | "partial";
}

const ROWS: Row[] = [
  { label: "Multi-source enrichment (8+)", crate: true, navidrome: false, plex: true, jellyfin: false },
  { label: "Audio analysis (BPM, key, mood)", crate: true, navidrome: false, plex: true, jellyfin: false },
  { label: "Adaptive EQ per track", crate: true, navidrome: false, plex: false, jellyfin: false },
  { label: "Bliss-based similarity radio", crate: true, navidrome: false, plex: false, jellyfin: false },
  { label: "Genre taxonomy with inheritance", crate: true, navidrome: false, plex: false, jellyfin: false },
  { label: "Upcoming shows + setlists", crate: true, navidrome: false, plex: false, jellyfin: false },
  { label: "Subsonic API", crate: true, navidrome: true, plex: false, jellyfin: false },
  { label: "Native mobile app", crate: true, navidrome: false, plex: true, jellyfin: true },
  { label: "Synced lyrics with seek-by-line", crate: true, navidrome: false, plex: true, jellyfin: false },
  { label: "Offline downloads", crate: true, navidrome: false, plex: true, jellyfin: true },
  { label: "Low-resource footprint", crate: false, navidrome: true, plex: "partial", jellyfin: "partial" },
  { label: "Comfortable on very small servers", crate: false, navidrome: true, plex: "partial", jellyfin: "partial" },
  { label: "Open source", crate: true, navidrome: true, plex: false, jellyfin: true },
];

function Cell({ value }: { value: boolean | "partial" }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-cyan-400/10">
        <Check size={13} className="text-cyan-400" />
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-white/[0.03]">
        <Minus size={13} className="text-white/20" />
      </span>
    );
  }
  return <span className="text-[13px] text-white/10">—</span>;
}

const COLS = [
  { key: "crate" as const, label: "Crate", highlight: true },
  { key: "navidrome" as const, label: "Navidrome", highlight: false },
  { key: "plex" as const, label: "Plex", highlight: false },
  { key: "jellyfin" as const, label: "Jellyfin", highlight: false },
];

export function Comparison() {
  return (
    <section id="compare" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Context
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          Crate asks for more machine.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          If you want a small music server that mostly stays out of the way, Navidrome
          may be a better fit. Crate does more background work: enrichment, audio
          analysis, acquisition, cache generation, admin views, and a separate listening
          app. That costs CPU, memory, and disk I/O.
        </p>
        <p className="mt-5 border-l border-cyan-300/35 pl-4 text-[14.5px] leading-7 text-white/52">
          Reducing that footprint is active work, especially around workers, read paths,
          caching, and native helpers. Even so, Crate is still an opinionated, heavier
          system. It should run comfortably, but it is not designed to be the lightest
          thing you can put on a tiny server.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[20px] border border-white/8">
        <table className="w-full table-fixed text-left">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-white/8">
              <th className="py-3.5 pl-5 pr-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35 sm:pl-7">
                Feature
              </th>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className={`py-3.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] ${
                    col.highlight ? "text-cyan-300" : "text-white/35"
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <tr
                key={row.label}
                className={`border-b border-white/[0.04] transition hover:bg-white/[0.02] ${
                  i === ROWS.length - 1 ? "border-b-0" : ""
                }`}
              >
                <td className="py-3.5 pl-5 pr-2 text-[14px] leading-tight text-white/75 sm:pl-7">
                  {row.label}
                </td>
                {COLS.map((col) => (
                  <td
                    key={col.key}
                    className={`py-3.5 text-center ${
                      col.highlight ? "bg-cyan-400/[0.03]" : ""
                    }`}
                  >
                    <Cell value={row[col.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-center text-[13px] text-white/30">
        Try the simple thing first. Use Crate when you actually want the extra work it does.
      </p>
    </section>
  );
}

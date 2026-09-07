import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { Download, Trash2 } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";

import type { LibraryContribution } from "./library-model";

export function LibraryBandcampImported({
  contributions,
  title,
  description,
  exportLabel,
  onExport,
  onWithdraw,
}: {
  contributions: LibraryContribution[];
  title: string;
  description: string;
  exportLabel: string;
  onExport: (contribution: LibraryContribution) => void;
  onWithdraw: (contribution: LibraryContribution) => void;
}) {
  if (!contributions.length) return null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-black uppercase tracking-[0.18em] text-accent-action">
          {title}
        </h3>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {contributions.map((contribution) => (
          <article
            key={contribution.id}
            className="flex items-center gap-3 rounded-xl border border-text-primary/8 bg-text-primary/[0.03] p-3"
          >
            <div className=" size-14 shrink-0 overflow-hidden rounded-xl border border-text-primary/8 bg-text-primary/6">
              {contribution.album_id ? (
                <CrateImage
                  src={albumCoverApiUrl(
                    {
                      albumId: contribution.album_id,
                      albumEntityUid: contribution.album_entity_uid,
                      artistName: contribution.artist_name,
                      albumName: contribution.album_name,
                    },
                    { size: 128 },
                  )}
                  alt=""
                  loading="lazy"
                  className=" size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <BandcampLogo size={20} className="text-accent-action/70" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-black text-text-primary">
                {contribution.album_name}
              </h4>
              <p className="truncate text-xs text-text-muted">
                {contribution.artist_name}
              </p>
            </div>
            <button
              type="button"
              disabled={!contribution.album_id}
              onClick={() => onExport(contribution)}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border-quiet px-3 text-xs font-bold text-text-muted disabled:opacity-40"
            >
              <Download size={14} />
              {exportLabel}
            </button>
            <button
              type="button"
              onClick={() => onWithdraw(contribution)}
              className="inline-flex min-h-10 items-center rounded-full border border-state-danger/20 px-3 text-xs font-bold text-state-danger"
            >
              <Trash2 size={14} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

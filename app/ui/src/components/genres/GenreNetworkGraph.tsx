import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import ForceGraph2D from "react-force-graph-2d";

import { useApi } from "@/hooks/use-api";

interface GenreGraphNode {
  id: string;
  slug: string;
  label: string;
  description?: string | null;
  kind: "library" | "taxonomy" | "top-level" | "unmapped";
  mapped: boolean;
  artist_count: number;
  album_count: number;
  page_slug?: string | null;
  is_center: boolean;
  is_top_level: boolean;
}

interface GenreGraphLink {
  source: string;
  target: string;
  relation_type: "alias" | "parent" | "child" | "related" | "influenced_by" | "fusion_of";
  weight: number;
}

interface GenreGraphData {
  nodes: GenreGraphNode[];
  links: GenreGraphLink[];
  mapping?: {
    mapped?: boolean;
    canonical_name?: string | null;
    top_level_name?: string | null;
    description?: string | null;
  };
}

const ACCENT = "rgba(56, 189, 248, 0.94)";
const ACCENT_SOFT = "rgba(56, 189, 248, 0.16)";
const ACCENT_FAINT = "rgba(56, 189, 248, 0.08)";
const PANEL = "rgba(2, 6, 23, 0.9)";
const PANEL_SOFT = "rgba(15, 23, 42, 0.84)";
const TEXT = "rgba(241, 245, 249, 0.95)";
const TEXT_MUTED = "rgba(148, 163, 184, 0.88)";
const INACTIVE_STROKE = "rgba(100, 116, 139, 0.35)";
const INACTIVE_FILL = "rgba(30, 41, 59, 0.5)";
const INACTIVE_TEXT = "rgba(148, 163, 184, 0.4)";

function isEmptyNode(node: GenreGraphNode): boolean {
  return node.artist_count === 0 && node.album_count === 0;
}

const RELATION_STYLES: Record<GenreGraphLink["relation_type"], { dash: number[]; width: number; opacity: number; label: string }> = {
  alias: { dash: [2, 5], width: 2.5, opacity: 0.96, label: "alias / mapped" },
  parent: { dash: [], width: 2.4, opacity: 0.9, label: "parent genre" },
  child: { dash: [9, 5], width: 2.2, opacity: 0.84, label: "subgenre" },
  related: { dash: [3, 9], width: 1.6, opacity: 0.64, label: "related scene" },
  influenced_by: { dash: [12, 5], width: 1.8, opacity: 0.78, label: "influenced by" },
  fusion_of: { dash: [1, 5], width: 2.05, opacity: 0.72, label: "fusion of" },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
}

function accent(alpha: number): string {
  return `rgba(56, 189, 248, ${alpha})`;
}

function relationLabel(relationType: GenreGraphLink["relation_type"]): string {
  return RELATION_STYLES[relationType].label;
}

function relationDash(relationType: GenreGraphLink["relation_type"], globalScale: number): number[] {
  const scale = Math.max(globalScale, 0.8);
  return RELATION_STYLES[relationType].dash.map((segment) => segment / scale);
}

function relationWidth(relationType: GenreGraphLink["relation_type"], globalScale: number): number {
  return RELATION_STYLES[relationType].width / Math.max(globalScale, 0.85);
}

function relationStroke(relationType: GenreGraphLink["relation_type"]): string {
  return accent(RELATION_STYLES[relationType].opacity);
}

export function GenreNetworkGraph({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(undefined);
  const [width, setWidth] = useState(0);
  const { data, loading } = useApi<GenreGraphData>(`/api/genres/${slug}/graph`);

  useEffect(() => {
    if (!containerRef.current) return;
    requestAnimationFrame(() => {
      if (containerRef.current) setWidth(containerRef.current.clientWidth);
    });
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextWidth = Math.floor(entry.contentRect.width);
        if (nextWidth > 0) setWidth(nextWidth);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const graph = fgRef.current;
    if (!graph || !data?.nodes?.length) return;
    const linkDistances: Record<string, number> = {
      alias: 84, parent: 102, child: 102, related: 132,
      influenced_by: 118, fusion_of: 124,
    };
    graph.d3Force("charge")?.strength(-260).distanceMax(320);
    graph.d3Force("link")?.distance((link: any) => linkDistances[link.relation_type] ?? 102);
    graph.d3Force("center")?.strength(0.12);
    graph.d3ReheatSimulation();
  }, [data?.nodes?.length, data?.links?.length]);

  const nodeSet = useMemo(
    () => new Map((data?.nodes || []).map((node) => [node.id, node])),
    [data?.nodes],
  );

  if (loading) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
        Loading genre graph...
      </div>
    );
  }

  if (!data?.nodes?.length) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
        No genre graph available.
      </div>
    );
  }

  const graphWidth = width || 900;

  return (
    <div className="rounded-md border border-border bg-card/70 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Genre map</div>
          {data.mapping?.description && (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{data.mapping.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {(
            Object.entries(RELATION_STYLES) as [GenreGraphLink["relation_type"], (typeof RELATION_STYLES)[GenreGraphLink["relation_type"]]][]
          ).map(([relationType, style]) => (
            <span
              key={relationType}
              className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1"
              style={{ borderColor: ACCENT_SOFT, backgroundColor: ACCENT_FAINT, color: TEXT_MUTED }}
            >
              <span
                className="block w-5 border-t"
                style={{ borderColor: relationStroke(relationType), borderTopStyle: style.dash.length ? "dashed" : "solid" }}
              />
              {style.label}
            </span>
          ))}
          <span
            className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1"
            style={{ borderColor: ACCENT_SOFT, backgroundColor: ACCENT_FAINT, color: TEXT_MUTED }}
          >
            <span className="block h-3 w-3 border" style={{ borderColor: ACCENT, backgroundColor: ACCENT_SOFT }} />
            main genre
          </span>
          <span
            className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1"
            style={{ borderColor: ACCENT_SOFT, backgroundColor: ACCENT_FAINT, color: TEXT_MUTED }}
          >
            <span className="block h-3 w-3 rounded-md border" style={{ borderColor: ACCENT, backgroundColor: PANEL_SOFT }} />
            scene / subgenre
          </span>
        </div>
      </div>

      <div ref={containerRef} style={{ width: "100%", height: 520 }}>
        <ForceGraph2D
          ref={fgRef}
          width={graphWidth}
          height={520}
          graphData={data}
          backgroundColor="transparent"
          linkColor={() => "rgba(0,0,0,0)"}
          linkWidth={() => 0}
          linkDirectionalParticles={0}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const source = typeof link.source === "object" ? link.source : null;
            const target = typeof link.target === "object" ? link.target : null;
            if (!source || !target) return;

            const sourceNode = nodeSet.get(source.id);
            const targetNode = nodeSet.get(target.id);
            const inactive = (sourceNode && isEmptyNode(sourceNode)) || (targetNode && isEmptyNode(targetNode));

            const relationType = (link.relation_type || "related") as GenreGraphLink["relation_type"];
            ctx.save();
            ctx.strokeStyle = inactive ? INACTIVE_STROKE : relationStroke(relationType);
            ctx.lineWidth = relationWidth(relationType, globalScale);
            ctx.setLineDash(relationDash(relationType, globalScale));
            ctx.beginPath();
            ctx.moveTo(source.x ?? 0, source.y ?? 0);
            ctx.lineTo(target.x ?? 0, target.y ?? 0);
            ctx.stroke();
            ctx.restore();
          }}
          nodeRelSize={6}
          nodeVal={(node: any) => {
            const currentNode = nodeSet.get(node.id);
            if (!currentNode) return 8;
            const base = currentNode.is_center ? 18 : currentNode.is_top_level ? 13 : currentNode.kind === "library" ? 12 : 10;
            return Math.max(base, base + Math.min(currentNode.artist_count, 120) / 9);
          }}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const currentNode = nodeSet.get(node.id);
            if (!currentNode) return;

            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const empty = isEmptyNode(currentNode);
            const baseSize = currentNode.is_center ? 18 : currentNode.is_top_level ? 14 : currentNode.kind === "library" ? 12 : 11;
            const size = empty
              ? baseSize * 0.75
              : Math.max(baseSize, baseSize + Math.min(currentNode.artist_count, 120) / 12);
            const strokeWidth = (currentNode.is_center ? 2.3 : currentNode.is_top_level ? 1.8 : 1.35) / Math.max(globalScale, 0.8);

            if (currentNode.is_center && !empty) {
              ctx.beginPath();
              ctx.arc(x, y, size + 7, 0, Math.PI * 2);
              ctx.fillStyle = accent(0.12);
              ctx.fill();
            }

            ctx.save();
            if (currentNode.kind === "library") {
              roundRect(ctx, x - size, y - size, size * 2, size * 2, 6);
            } else if (currentNode.kind === "unmapped") {
              drawDiamond(ctx, x, y, size + 2);
            } else if (currentNode.is_top_level) {
              ctx.beginPath();
              ctx.rect(x - size, y - size, size * 2, size * 2);
              ctx.closePath();
            } else {
              ctx.beginPath();
              ctx.arc(x, y, size, 0, Math.PI * 2);
            }

            if (empty) {
              ctx.fillStyle = INACTIVE_FILL;
            } else if (currentNode.kind === "unmapped") {
              ctx.fillStyle = PANEL;
            } else if (currentNode.is_top_level) {
              ctx.fillStyle = currentNode.is_center ? accent(0.28) : ACCENT_SOFT;
            } else if (currentNode.kind === "library") {
              ctx.fillStyle = accent(0.18);
            } else {
              ctx.fillStyle = PANEL_SOFT;
            }
            ctx.fill();

            ctx.strokeStyle = empty ? INACTIVE_STROKE : ACCENT;
            ctx.lineWidth = strokeWidth;
            ctx.setLineDash(currentNode.kind === "unmapped" ? [5 / Math.max(globalScale, 0.9), 4 / Math.max(globalScale, 0.9)] : []);
            ctx.stroke();
            ctx.restore();

            // Badge — skip for empty nodes
            if (!empty) {
              const countLabel = `${currentNode.artist_count}`;
              const badgeFontSize = Math.max(9, 11 / globalScale);
              ctx.font = `600 ${badgeFontSize}px ui-sans-serif, system-ui`;
              const badgeWidth = ctx.measureText(countLabel).width + 14;
              const badgeHeight = 16 / globalScale;
              const badgeX = x - badgeWidth / 2;
              const badgeY = y - size - badgeHeight - 4;
              roundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 8 / globalScale);
              ctx.fillStyle = PANEL;
              ctx.fill();
              ctx.strokeStyle = ACCENT;
              ctx.lineWidth = 1 / Math.max(globalScale, 0.9);
              ctx.stroke();
              ctx.fillStyle = TEXT;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(countLabel, x, badgeY + badgeHeight / 2 + 0.5);
            }

            const labelFontSize = Math.max(9, 12 / globalScale);
            ctx.font = `${currentNode.is_center ? "700" : currentNode.is_top_level ? "600" : "500"} ${labelFontSize}px ui-sans-serif, system-ui`;
            ctx.fillStyle = empty ? INACTIVE_TEXT : TEXT;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(currentNode.label, x, y + size + 6);
          }}
          nodeLabel={(node: any) => {
            const currentNode = nodeSet.get(node.id);
            if (!currentNode) return "";
            return `
              <div style="background:${PANEL};border:1px solid ${ACCENT_SOFT};border-radius:12px;padding:10px 12px;min-width:240px;box-shadow:0 10px 24px rgba(0,0,0,0.35)">
                <div style="font-weight:700;color:${TEXT};margin-bottom:6px">${escapeHtml(currentNode.label)}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:${TEXT_MUTED}">
                  <span>${currentNode.artist_count} artists</span>
                  <span>${currentNode.album_count} albums</span>
                  <span>${escapeHtml(currentNode.is_top_level ? "main genre" : currentNode.kind)}</span>
                </div>
                ${currentNode.description ? `<div style="margin-top:8px;font-size:11px;line-height:1.45;color:${TEXT_MUTED}">${escapeHtml(currentNode.description)}</div>` : ""}
                ${currentNode.page_slug ? `<div style="margin-top:8px;font-size:10px;color:${ACCENT}">click to open genre</div>` : ""}
              </div>
            `;
          }}
          onNodeClick={(node: any) => {
            const currentNode = nodeSet.get(node.id);
            if (currentNode?.page_slug) {
              navigate(`/genres/${encodeURIComponent(currentNode.page_slug)}`);
            }
          }}
          linkLabel={(link: any) => relationLabel((link.relation_type || "related") as GenreGraphLink["relation_type"])}
        />
      </div>
    </div>
  );
}

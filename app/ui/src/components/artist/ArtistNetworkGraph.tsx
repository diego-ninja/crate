import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import ForceGraph2D from "react-force-graph-2d";

import { api } from "@/lib/api";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface NetworkNode {
  id: string;
  group: number;
  in_library: boolean;
  score: number;
  artist_id?: number;
  artist_slug?: string;
}

interface NetworkLink {
  source: string;
  target: string;
  value: number;
}

interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

interface ArtistNetworkGraphProps {
  centerArtist: string;
  centerArtistId?: number;
}

function artistNetworkApiPath(name: string, artistId?: number, depth?: number) {
  if (artistId != null) {
    const params = depth != null ? `?depth=${depth}` : "";
    return `/api/artists/${artistId}/network${params}`;
  }
  const qs = new URLSearchParams({ name });
  if (depth != null) qs.set("depth", String(depth));
  return `/api/network/external-artist?${qs}`;
}

export function ArtistNetworkGraph({ centerArtist, centerArtistId }: ArtistNetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(undefined);
  const navigate = useNavigate();
  const [width, setWidth] = useState(0);
  const [height] = useState(Math.min(600, Math.round(window.innerHeight * 0.55)));
  const [networkData, setNetworkData] = useState<NetworkData>({ nodes: [], links: [] });
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [artistsWithShows, setArtistsWithShows] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ artists: string[] }>("/api/shows/artists-with-shows")
      .then((data) => setArtistsWithShows(new Set(data.artists.map((artist) => artist.toLowerCase()))))
      .catch(() => {});

    setLoading(true);
    setExpandedNodes(new Set([centerArtist]));
    api<NetworkData>(artistNetworkApiPath(centerArtist, centerArtistId))
      .then((data) => setNetworkData(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [centerArtist, centerArtistId]);

  function expandNode(node: NetworkNode) {
    if (expandedNodes.has(node.id)) return;
    setExpandedNodes((previous) => new Set([...previous, node.id]));
    api<NetworkData>(artistNetworkApiPath(node.id, node.artist_id, 1))
      .then((data) => {
        setNetworkData((previous) => {
          // Case-insensitive dedup — artist names vary in casing across sources
          const existingIds = new Set(previous.nodes.map((n) => n.id.toLowerCase()));
          const existingLinkKeys = new Set(previous.links.map((l) => {
            const s = typeof l.source === "string" ? l.source : (l.source as any)?.id ?? "";
            const t = typeof l.target === "string" ? l.target : (l.target as any)?.id ?? "";
            return `${s.toLowerCase()}||${t.toLowerCase()}`;
          }));
          const newNodes = data.nodes.filter((n) => !existingIds.has(n.id.toLowerCase()));
          const newLinks = data.links.filter((l) => {
            const key = `${l.source.toLowerCase()}||${l.target.toLowerCase()}`;
            const rev = `${l.target.toLowerCase()}||${l.source.toLowerCase()}`;
            return !existingLinkKeys.has(key) && !existingLinkKeys.has(rev);
          });
          // Remap new links to use existing node IDs (preserve original casing)
          const idMap = new Map(previous.nodes.map((n) => [n.id.toLowerCase(), n.id]));
          for (const n of newNodes) idMap.set(n.id.toLowerCase(), n.id);
          const remappedLinks = newLinks.map((l) => ({
            ...l,
            source: idMap.get(l.source.toLowerCase()) ?? l.source,
            target: idMap.get(l.target.toLowerCase()) ?? l.target,
          }));
          return {
            nodes: [...previous.nodes, ...newNodes],
            links: [...previous.links, ...remappedLinks],
          };
        });
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!containerRef.current) return;
    requestAnimationFrame(() => {
      if (containerRef.current) setWidth(containerRef.current.clientWidth);
    });
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new MutationObserver(() => {
      const tooltips = container.querySelectorAll<HTMLElement>("div[style*='background: rgba']");
      tooltips.forEach((element) => {
        element.style.background = "transparent";
        element.style.padding = "0";
        element.style.border = "none";
        element.style.borderRadius = "0";
        element.style.font = "inherit";
        element.style.color = "inherit";
      });
    });
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-200).distanceMax(350);
    graph.d3Force("link")?.distance(100);
    graph.d3Force("center")?.strength(0.05);
    graph.d3ReheatSimulation();
  }, [networkData.nodes.length]);

  if (loading || width === 0) {
    return (
      <div ref={containerRef} style={{ height }} className="flex w-full items-center justify-center text-muted-foreground text-sm">
        Loading network...
      </div>
    );
  }

  if (networkData.nodes.length <= 1) {
    return (
      <div ref={containerRef} style={{ height }} className="flex w-full items-center justify-center text-muted-foreground text-sm">
        No similarity data available — run backfill-similarities task to populate.
      </div>
    );
  }

  const nodeSet = new Map(networkData.nodes.map((node) => [node.id.toLowerCase(), node]));

  return (
    <div ref={containerRef} style={{ height }} className="w-full overflow-hidden">
      <ForceGraph2D
        ref={fgRef}
        width={width}
        height={height}
        graphData={networkData}
        backgroundColor="transparent"
        nodeRelSize={6}
        nodeVal={(node: any) => {
          const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as NetworkNode | undefined;
          const score = currentNode?.score ?? 0;
          if (node.id?.toLowerCase() === centerArtist.toLowerCase()) return Math.max(4, score * 20);
          return Math.max(1.5, score * 10);
        }}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as NetworkNode | undefined;
          const score = currentNode?.score ?? 0;
          const inLibrary = currentNode?.in_library ?? false;
          const hasShows = artistsWithShows.has(node.id.toLowerCase());
          const isCenter = node.id?.toLowerCase() === centerArtist.toLowerCase();

          const baseSize = isCenter ? 14 : inLibrary ? 7 : 5;
          const scoreBonus = score * 8;
          const size = Math.max(baseSize, baseSize + scoreBonus);

          const x = node.x ?? 0;
          const y = node.y ?? 0;

          // Glow for center and in-library
          if (isCenter || inLibrary) {
            ctx.beginPath();
            ctx.arc(x, y, size + 6, 0, 2 * Math.PI);
            ctx.fillStyle = isCenter ? "rgba(6,182,212,0.12)" : "rgba(6,182,212,0.06)";
            ctx.fill();
          }

          // Shows ring
          if (hasShows) {
            ctx.beginPath();
            ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
            ctx.strokeStyle = "rgba(249,115,22,0.6)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Main circle
          ctx.beginPath();
          ctx.arc(x, y, size, 0, 2 * Math.PI);
          if (isCenter) {
            ctx.fillStyle = "#06b6d4";
          } else if (inLibrary) {
            ctx.fillStyle = "#0e7490";
          } else {
            ctx.fillStyle = "#2a2a3a";
          }
          ctx.fill();

          // Border
          ctx.strokeStyle = isCenter ? "#22d3ee" : inLibrary ? "#06b6d4" : "rgba(255,255,255,0.08)";
          ctx.lineWidth = isCenter ? 2.5 : inLibrary ? 1.5 : 0.5;
          ctx.stroke();

          // Label
          const fontSize = Math.max(10, 12 / globalScale);
          ctx.font = `${isCenter || inLibrary ? "600 " : "400 "}${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isCenter ? "rgba(255,255,255,0.95)" : inLibrary ? "rgba(241,245,249,0.85)" : "rgba(241,245,249,0.4)";
          ctx.fillText(node.id, x, y + size + 4);

          // In-library satellite dot
          if (inLibrary && !isCenter) {
            ctx.beginPath();
            ctx.arc(x + size * 0.7, y - size * 0.7, 3, 0, 2 * Math.PI);
            ctx.fillStyle = "#22d3ee";
            ctx.fill();
            ctx.strokeStyle = "#0a0a14";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }}
        linkColor={(link: any) => {
          const sId = (typeof link.source === "string" ? link.source : link.source?.id ?? "").toLowerCase();
          const tId = (typeof link.target === "string" ? link.target : link.target?.id ?? "").toLowerCase();
          const sNode = nodeSet.get(sId);
          const tNode = nodeSet.get(tId);
          if (sNode?.in_library && tNode?.in_library) return "rgba(6,182,212,0.25)";
          return "rgba(100,116,139,0.15)";
        }}
        linkWidth={(link: any) => {
          const v = typeof link.value === "number" ? link.value : 0.5;
          return Math.max(0.5, v * 2);
        }}
        nodeLabel={(node: any) => {
          const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as NetworkNode | undefined;
          const inLibrary = currentNode?.in_library ?? false;
          const score = currentNode?.score ?? 0;
          const photoUrl = currentNode?.artist_id != null
            ? artistPhotoApiUrl({ artistId: currentNode.artist_id, artistSlug: currentNode.artist_slug, artistName: node.id })
            : "";
          return `<div style="background:var(--color-card);border:1px solid var(--color-border);border-radius:10px;padding:0;font-size:12px;min-width:200px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.4)">
            <div style="display:flex;align-items:center;gap:8px;padding:10px 12px">
              ${photoUrl ? `<img src="${photoUrl}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;background:#1c1c28" onerror="this.style.display='none'" />` : ""}
              <div style="min-width:0;flex:1">
                <div style="font-weight:600;color:var(--color-foreground)">${escapeHtml(node.id)}</div>
              </div>
            </div>
            ${score > 0 ? `<div style="padding:0 12px 8px">
              <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:5px;background:#1c1c28;border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(score * 100)}%;border-radius:3px;background:linear-gradient(90deg,#06b6d433,#06b6d4)"></div>
                </div>
                <span style="font-size:9px;color:var(--color-muted-foreground)">${Math.round(score * 100)}%</span>
              </div>
            </div>` : ""}
            <div style="padding:6px 12px;border-top:1px solid var(--color-border);font-size:10px;display:flex;justify-content:space-between;align-items:center">
              <span style="color:${inLibrary ? "#06b6d4" : "var(--color-muted-foreground)"}">${inLibrary ? "In library" : "Not in library"}</span>
              ${artistsWithShows.has(node.id.toLowerCase()) ? `<span style="color:#f97316">Shows</span>` : ""}
              <span style="color:var(--color-primary)">Click to navigate</span>
            </div>
          </div>`;
        }}
        onNodeClick={(node: any) => {
          expandNode(node as NetworkNode);
        }}
        onNodeRightClick={(node: any) => {
          const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as NetworkNode | undefined;
          if (currentNode?.in_library && currentNode.artist_id != null) {
            navigate(artistPagePath({ artistId: currentNode.artist_id, artistSlug: currentNode.artist_slug, artistName: node.id }));
          } else {
            navigate(`/download?q=${encodeURIComponent(node.id)}`);
          }
        }}
        cooldownTicks={200}
        d3AlphaDecay={0.01}
        d3VelocityDecay={0.2}
        warmupTicks={50}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        enableNodeDrag={true}
        onEngineStop={() => {
          fgRef.current?.zoomToFit(400, 60);
        }}
      />
    </div>
  );
}

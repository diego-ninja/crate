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
          const existingIds = new Set(previous.nodes.map((node) => node.id));
          const existingLinks = new Set(previous.links.map((link) => `${link.source}-${link.target}`));
          const newNodes = data.nodes.filter((node) => !existingIds.has(node.id));
          const newLinks = data.links.filter((link) => {
            const key = `${link.source}-${link.target}`;
            const reverseKey = `${link.target}-${link.source}`;
            return !existingLinks.has(key) && !existingLinks.has(reverseKey);
          });
          return {
            nodes: [...previous.nodes, ...newNodes],
            links: [...previous.links, ...newLinks],
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
        const nextWidth = Math.floor(entry.contentRect.width);
        if (nextWidth > 0) setWidth(nextWidth);
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
    graph.d3Force("charge")?.strength(-150).distanceMax(250);
    graph.d3Force("link")?.distance(80);
    graph.d3Force("center")?.strength(0.1);
    graph.d3ReheatSimulation();
  }, [networkData.nodes.length]);

  if (loading) {
    return (
      <div style={{ height: 500 }} className="flex items-center justify-center text-muted-foreground text-sm">
        Loading network...
      </div>
    );
  }

  if (networkData.nodes.length <= 1) {
    return (
      <div ref={containerRef} style={{ height: 500 }} className="flex items-center justify-center text-muted-foreground text-sm">
        No similarity data available — run backfill-similarities task to populate.
      </div>
    );
  }

  const nodeSet = new Map(networkData.nodes.map((node) => [node.id, node]));
  const graphWidth = width || 800;

  return (
    <div ref={containerRef} style={{ width: "100%", height: 500 }}>
      <ForceGraph2D
        ref={fgRef}
        width={graphWidth}
        height={500}
        graphData={networkData}
        backgroundColor="transparent"
        nodeRelSize={6}
        nodeVal={(node: any) => {
          const currentNode = nodeSet.get(node.id) as NetworkNode | undefined;
          const score = currentNode?.score ?? 0;
          if (node.id === centerArtist) return Math.max(4, score * 20);
          return Math.max(1.5, score * 10);
        }}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const currentNode = nodeSet.get(node.id) as NetworkNode | undefined;
          const score = currentNode?.score ?? 0;
          const inLibrary = currentNode?.in_library ?? false;
          const hasShows = artistsWithShows.has(node.id.toLowerCase());
          const isCenter = node.id === centerArtist;

          const baseSize = isCenter ? 10 : 4;
          const scoreBonus = score * 10;
          const size = Math.max(baseSize, baseSize + scoreBonus);

          const x = node.x ?? 0;
          const y = node.y ?? 0;

          if (hasShows) {
            ctx.beginPath();
            ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
            ctx.strokeStyle = "rgba(249,115,22,0.5)";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          if (isCenter) {
            ctx.beginPath();
            ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
            ctx.fillStyle = "rgba(6,182,212,0.15)";
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(x, y, size, 0, 2 * Math.PI);
          ctx.fillStyle = isCenter ? "#06b6d4" : inLibrary ? "#06b6d4" : "#3f3f50";
          ctx.fill();

          ctx.strokeStyle = isCenter ? "#0891b2" : inLibrary ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.15)";
          ctx.lineWidth = isCenter ? 2 : 1;
          ctx.stroke();

          const fontSize = Math.max(9, 11 / globalScale);
          ctx.font = `${isCenter ? "bold " : ""}${fontSize}px -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = inLibrary ? "rgba(241,245,249,0.95)" : "rgba(241,245,249,0.5)";
          ctx.fillText(node.id, x, y + size + 3);

          if (inLibrary && !isCenter) {
            ctx.beginPath();
            ctx.arc(x + size - 1, y - size + 1, 2.5, 0, 2 * Math.PI);
            ctx.fillStyle = "#06b6d4";
            ctx.fill();
          }
        }}
        linkColor={() => "rgba(100,116,139,0.3)"}
        linkWidth={1}
        nodeLabel={(node: any) => {
          const currentNode = nodeSet.get(node.id) as NetworkNode | undefined;
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
          const currentNode = nodeSet.get(node.id) as NetworkNode | undefined;
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

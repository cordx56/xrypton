"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { MultiDirectedGraph } from "graphology";
import Sigma from "sigma";
import { createEdgeArrowProgram } from "sigma/rendering";
import { createNodeImageProgram } from "@sigma/node-image";

type GraphNode = {
  fingerprint: string;
  userId: string | null;
};

type GraphEdge = {
  from: string;
  to: string;
};

type ProfileMeta = {
  displayName: string;
  iconUrl: string | null;
  iconSignature: string;
  signingPublicKey?: string;
};

type Props = {
  rootFingerprint: string;
  targetFingerprint: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  profiles: Record<string, ProfileMeta>;
  userIdByFingerprint: Record<string, string | null>;
  onOpenProfile: (userId: string) => void;
};

type SigmaNodeAttributes = {
  x: number;
  y: number;
  label: string;
  size: number;
  color: string;
  userId: string | null;
  image: string | null;
};

type SigmaEdgeAttributes = {
  size: number;
  color: string;
  type: "arrow";
};

const HORIZONTAL_GAP = 4;
const VERTICAL_GAP = 2.4;

type ThemeColors = {
  foreground: string;
  rootNode: string;
  targetNode: string;
  defaultNode: string;
  targetEdge: string;
  defaultEdge: string;
};

const DEFAULT_THEME_COLORS: ThemeColors = {
  foreground: "#171717",
  rootNode: "#171717",
  targetNode: "#6c8ebf",
  defaultNode: "#6b7280",
  targetEdge: "#6c8ebf",
  defaultEdge: "#6b7280",
};

function readThemeColors(): ThemeColors {
  if (typeof window === "undefined") return DEFAULT_THEME_COLORS;
  const styles = window.getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue("--accent").trim();
  const muted = styles.getPropertyValue("--muted").trim();
  const foreground = styles.getPropertyValue("--foreground").trim();

  return {
    foreground: foreground || DEFAULT_THEME_COLORS.foreground,
    rootNode: foreground || DEFAULT_THEME_COLORS.rootNode,
    targetNode: accent || DEFAULT_THEME_COLORS.targetNode,
    defaultNode: muted || DEFAULT_THEME_COLORS.defaultNode,
    targetEdge: accent || DEFAULT_THEME_COLORS.targetEdge,
    defaultEdge: muted || DEFAULT_THEME_COLORS.defaultEdge,
  };
}

function buildNodePositions(
  rootFingerprint: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, { x: number; y: number }> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.fingerprint, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const depthByFingerprint = new Map<string, number>();
  if (adjacency.has(rootFingerprint)) {
    depthByFingerprint.set(rootFingerprint, 0);
    const queue: string[] = [rootFingerprint];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const currentDepth = depthByFingerprint.get(current);
      if (currentDepth === undefined) continue;

      for (const next of adjacency.get(current) ?? []) {
        if (depthByFingerprint.has(next)) continue;
        depthByFingerprint.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }

  const knownDepths = [...depthByFingerprint.values()];
  const fallbackDepth =
    knownDepths.length > 0 ? Math.max(...knownDepths) + 1 : 0;

  for (const node of nodes) {
    if (depthByFingerprint.has(node.fingerprint)) continue;
    depthByFingerprint.set(node.fingerprint, fallbackDepth);
  }

  const groupedByDepth = new Map<number, string[]>();
  for (const node of nodes) {
    const depth = depthByFingerprint.get(node.fingerprint);
    if (depth === undefined) continue;
    const group = groupedByDepth.get(depth) ?? [];
    group.push(node.fingerprint);
    groupedByDepth.set(depth, group);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [depth, fingerprints] of groupedByDepth.entries()) {
    fingerprints.sort((a, b) => a.localeCompare(b));
    const half = (fingerprints.length - 1) / 2;
    fingerprints.forEach((fingerprint, idx) => {
      positions.set(fingerprint, {
        x: depth * HORIZONTAL_GAP,
        y: (idx - half) * VERTICAL_GAP,
      });
    });
  }

  return positions;
}

export default function WotGraphDialog({
  rootFingerprint,
  targetFingerprint,
  nodes,
  edges,
  profiles,
  userIdByFingerprint,
  onOpenProfile,
}: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [themeColors, setThemeColors] =
    useState<ThemeColors>(DEFAULT_THEME_COLORS);

  useEffect(() => {
    const applyThemeColors = () => {
      setThemeColors(readThemeColors());
    };

    applyThemeColors();

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      applyThemeColors();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-mode", "data-theme", "class", "style"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  const graph = useMemo(() => {
    const g = new MultiDirectedGraph<
      SigmaNodeAttributes,
      SigmaEdgeAttributes
    >();
    const positions = buildNodePositions(rootFingerprint, nodes, edges);

    for (const node of nodes) {
      const userId = userIdByFingerprint[node.fingerprint] ?? node.userId;
      const profile = userId ? profiles[userId] : null;
      const label =
        profile?.displayName ?? userId ?? node.fingerprint.slice(0, 16);
      const position = positions.get(node.fingerprint) ?? { x: 0, y: 0 };
      const color =
        node.fingerprint === targetFingerprint
          ? themeColors.targetNode
          : node.fingerprint === rootFingerprint
            ? themeColors.rootNode
            : themeColors.defaultNode;

      g.addNode(node.fingerprint, {
        ...position,
        label,
        size: node.fingerprint === targetFingerprint ? 26 : 20,
        color,
        userId,
        image: profile?.iconUrl ?? null,
      });
    }

    for (const [idx, edge] of edges.entries()) {
      if (!g.hasNode(edge.from) || !g.hasNode(edge.to)) continue;

      g.addDirectedEdgeWithKey(
        `${edge.from}-${edge.to}-${idx}`,
        edge.from,
        edge.to,
        {
          size: edge.to === targetFingerprint ? 4 : 3,
          color:
            edge.to === targetFingerprint
              ? themeColors.targetEdge
              : themeColors.defaultEdge,
          type: "arrow",
        },
      );
    }

    return g;
  }, [
    edges,
    nodes,
    profiles,
    rootFingerprint,
    targetFingerprint,
    themeColors,
    userIdByFingerprint,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const NodeProgram = createNodeImageProgram({
      drawingMode: "background",
      keepWithinCircle: true,
      padding: 0,
    });

    const BigArrowProgram = createEdgeArrowProgram({
      widenessToThicknessRatio: 2.5,
      lengthToThicknessRatio: 3,
    });

    const renderer = new Sigma(graph, container, {
      defaultNodeType: "image",
      nodeProgramClasses: { image: NodeProgram },
      defaultEdgeType: "arrow",
      edgeProgramClasses: { arrow: BigArrowProgram },
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 0,
      labelDensity: 1.2,
      labelSize: 16,
      labelColor: { color: themeColors.foreground },
      zIndex: true,
      maxCameraRatio: 3,
      minCameraRatio: 0.08,
    });

    const clickNode = ({ node }: { node: string }) => {
      const userId = graph.getNodeAttribute(node, "userId");
      if (typeof userId === "string" && userId.length > 0) {
        onOpenProfile(userId);
      }
    };

    const enterNode = ({ node }: { node: string }) => {
      const userId = graph.getNodeAttribute(node, "userId");
      container.style.cursor =
        typeof userId === "string" && userId.length > 0 ? "pointer" : "grab";
    };

    const leaveNode = () => {
      container.style.cursor = "grab";
    };

    renderer.on("clickNode", clickNode);
    renderer.on("enterNode", enterNode);
    renderer.on("leaveNode", leaveNode);

    container.style.cursor = "grab";
    renderer
      .getCamera()
      .animatedReset({ duration: 180 })
      .catch(() => undefined);

    const observer = new ResizeObserver(() => {
      renderer.resize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      container.style.cursor = "";
      renderer.off("clickNode", clickNode);
      renderer.off("enterNode", enterNode);
      renderer.off("leaveNode", leaveNode);
      renderer.kill();
    };
  }, [graph, onOpenProfile, themeColors.foreground]);

  return (
    <div className="h-[60vh] w-full">
      <div className="text-xs text-muted mb-2">
        {t("wot.trust_graph")}: {rootFingerprint.slice(0, 8)}... →{" "}
        {targetFingerprint.slice(0, 8)}...
      </div>
      <div
        ref={containerRef}
        className="h-[calc(100%-1.5rem)] w-full rounded-lg border border-accent/30"
      />
    </div>
  );
}

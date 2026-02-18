"use client";

import { useMemo } from "react";
import { useI18n } from "@/contexts/I18nContext";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Edge,
  Handle,
  MarkerType,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

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

type NodeData = {
  name: string;
  iconUrl: string | null;
  userId: string | null;
  onOpenProfile: (userId: string) => void;
};

const NODE_WIDTH = 160;
const NODE_HEIGHT = 88;

function FlowNode({ data }: { data: NodeData }) {
  return (
    <div
      className={`rounded-lg border px-2 py-2 bg-bg text-center min-w-[150px] ${
        data.userId ? "cursor-pointer hover:border-accent" : ""
      }`}
      onClick={() => data.userId && data.onOpenProfile(data.userId)}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex flex-col items-center gap-1">
        {data.iconUrl ? (
          <img
            src={data.iconUrl}
            alt={data.name}
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold">
            {data.name.charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <div className="text-[11px] text-muted leading-tight line-clamp-2">
          {data.name}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { userNode: FlowNode };

function layout(nodes: Node<NodeData>[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 72, nodesep: 36 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  return nodes.map((node) => {
    const p = g.node(node.id);
    return {
      ...node,
      position: {
        x: p.x - NODE_WIDTH / 2,
        y: p.y - NODE_HEIGHT / 2,
      },
    };
  });
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
  const { flowNodes, flowEdges } = useMemo(() => {
    const mappedNodes: Node<NodeData>[] = nodes.map((n) => {
      const userId = userIdByFingerprint[n.fingerprint] ?? n.userId;
      const profile = userId ? profiles[userId] : null;
      const label =
        profile?.displayName ??
        `${n.fingerprint.slice(0, 8)} ${n.fingerprint.slice(-8)}`;
      return {
        id: n.fingerprint,
        type: "userNode",
        data: {
          name: label,
          iconUrl: profile?.iconUrl ?? null,
          userId,
          onOpenProfile,
        },
        position: { x: 0, y: 0 },
      };
    });
    const mappedEdges: Edge[] = edges.map((e, idx) => ({
      id: `${e.from}-${e.to}-${idx}`,
      source: e.from,
      target: e.to,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke:
          e.to === targetFingerprint
            ? "var(--color-accent)"
            : "var(--color-muted, #888)",
      },
    }));

    return {
      flowNodes: layout(mappedNodes, mappedEdges),
      flowEdges: mappedEdges,
    };
  }, [
    edges,
    nodes,
    onOpenProfile,
    profiles,
    targetFingerprint,
    userIdByFingerprint,
  ]);

  return (
    <div className="h-[60vh] w-[min(90vw,860px)]">
      <div className="text-xs text-muted mb-2">
        {t("wot.trust_graph")}: {rootFingerprint.slice(0, 8)}... →{" "}
        {targetFingerprint.slice(0, 8)}...
      </div>
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={18} size={1} />
          <Controls />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

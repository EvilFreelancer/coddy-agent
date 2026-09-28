import {
  CLIENT_UUID,
  layoutTopology,
  nodeHalfHeight,
  nodeHalfWidth,
  type LayoutOptions,
  type PlacedNode,
  type TopologyLayout,
} from "./layout";
import type { SwarmTopology } from "./types";

const ITERATIONS = 180;
const COLLISION_PASSES = 12;
// The extra fraction keeps the 24px clearance after rounding both coordinates.
const GAP = 24.2;
const MARGIN = 48;
const BOTTOM_MARGIN = 96;
const SPRING = 0.024;
const REPULSION = 24000;
const DAMPING = 0.8;
const MAX_STEP = 12;

type Body = {
  node: PlacedNode;
  halfWidth: number;
  halfHeight: number;
  pinned: boolean;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
};

/**
 * A rooted force layout, without timers or random state. Route depth only seeds
 * the positions; the solver never snaps nodes onto hop rows. Each of its 180
 * steps visits UUID-ordered pairs and edges, so a poll's enumeration order does
 * not change the result. After O(V log V + E log E) sorting, the solver takes
 * O(180 * (V² + E)) work and O(V + E) storage.
 */
export function layoutTopologyStar(
  topology: SwarmTopology,
  opts: LayoutOptions = {},
): TopologyLayout {
  const tree = layoutTopology(topology, opts);
  const rootUUID = opts.client ? CLIENT_UUID : topology.root.uuid;
  const bodies = tree.nodes
    .sort((a, b) => compare(a.uuid, b.uuid))
    .map((node) => seed(node, rootUUID, opts.client ? 1 : 0));
  const byUUID = new Map(bodies.map((body) => [body.node.uuid, body]));
  // layoutTopology always includes the topology root (and client when given).
  const root = byUUID.get(rootUUID)!;
  const edges = [...tree.edges].sort((a, b) => compare(a.id, b.id));
  const links = edges.map((edge) => ({
    from: byUUID.get(edge.from.uuid)!,
    to: byUUID.get(edge.to.uuid)!,
  }));

  for (let step = 0; step < ITERATIONS; step += 1) {
    for (const body of bodies) {
      // A weak pull towards the root's axis and into its lower half-plane.
      body.fx = -body.node.x * 0.002;
      body.fy = 0.12 - body.node.y * 0.0008;
    }
    eachPair(bodies, repel);
    for (const { from, to } of links) attract(from, to);
    for (const body of bodies) {
      if (body.pinned) continue;
      body.vx = clampStep((body.vx + body.fx) * DAMPING);
      body.vy = clampStep((body.vy + body.fy) * DAMPING);
      body.node.x += body.vx;
      body.node.y += body.vy;
    }
    separate(bodies, root);
  }
  for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
    separate(bodies, root);
  }
  finishCollisions(bodies);

  // Symmetric horizontal margins centre the pinned root, not the bounding box
  // of an asymmetric swarm. The bottom margin also holds the discs' captions.
  const extentX = Math.max(
    ...bodies.map((body) => Math.abs(body.node.x) + body.halfWidth),
  );
  const halfWidth = Math.ceil((extentX + MARGIN) * 10) / 10;
  const offsetY = MARGIN + root.halfHeight;
  const nodes = bodies.map(({ node }) => ({
    ...node,
    x: round(node.x + halfWidth),
    y: round(node.y + offsetY),
  }));
  const placed = new Map(nodes.map((node) => [node.uuid, node]));
  const right = Math.max(...nodes.map((n) => n.x + nodeHalfWidth(n)));
  const bottom = Math.max(...nodes.map((n) => n.y + nodeHalfHeight(n)));
  return {
    nodes,
    edges: edges.map((edge) => ({
      ...edge,
      from: placed.get(edge.from.uuid)!,
      to: placed.get(edge.to.uuid)!,
      laneX: round(right + GAP),
    })),
    tiers: [],
    spineX: MARGIN / 2,
    width: round(halfWidth * 2),
    height: round(bottom + BOTTOM_MARGIN),
  };
}

function seed(node: PlacedNode, rootUUID: string, lift: number): Body {
  const pinned = node.uuid === rootUUID;
  const hash = hashUUID(node.uuid);
  const angle = (0.1 + (hash / 0x100000000) * 0.8) * Math.PI;
  const radius = 160 + Math.max(0, node.depth + lift) * 100 + (hash & 63);
  return {
    node: {
      ...node,
      x: pinned ? 0 : Math.cos(angle) * radius,
      y: pinned ? 0 : Math.sin(angle) * radius,
    },
    halfWidth: nodeHalfWidth(node),
    halfHeight: nodeHalfHeight(node),
    pinned,
    vx: 0,
    vy: 0,
    fx: 0,
    fy: 0,
  };
}

/** FNV-1a over UTF-16 code units, with an explicit unsigned 32-bit result. */
function hashUUID(uuid: string): number {
  let hash = 2166136261;
  for (let i = 0; i < uuid.length; i += 1) {
    hash = Math.imul(hash ^ uuid.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function eachPair(bodies: Body[], visit: (a: Body, b: Body) => void): void {
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      visit(bodies[i]!, bodies[j]!);
    }
  }
}

function repel(a: Body, b: Body): void {
  let dx = b.node.x - a.node.x;
  let dy = b.node.y - a.node.y;
  if (dx === 0 && dy === 0) {
    // Hash collisions must not leave coincident nodes with a zero force vector.
    const angle =
      (hashUUID(`${a.node.uuid}\0${b.node.uuid}`) / 0x100000000) * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  }
  const distance = Math.hypot(dx, dy);
  const force = REPULSION / Math.max(distance, GAP) ** 2;
  const fx = (dx / distance) * force;
  const fy = (dy / distance) * force;
  a.fx -= fx;
  a.fy -= fy;
  b.fx += fx;
  b.fy += fy;
}

function attract(a: Body, b: Body): void {
  const dx = b.node.x - a.node.x;
  const dy = b.node.y - a.node.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const restLength = 140 + a.halfWidth + b.halfWidth;
  const force = (distance - restLength) * SPRING;
  const fx = (dx / distance) * force;
  const fy = (dy / distance) * force;
  a.fx += fx;
  a.fy += fy;
  b.fx -= fx;
  b.fy -= fy;
}

function separate(bodies: Body[], root: Body): void {
  eachPair(bodies, (a, b) => {
    const dx = b.node.x - a.node.x;
    const dy = b.node.y - a.node.y;
    const overlapX = a.halfWidth + b.halfWidth + GAP - Math.abs(dx);
    const overlapY = a.halfHeight + b.halfHeight + GAP - Math.abs(dy);
    if (overlapX <= 0 || overlapY <= 0) return;
    const aShare = a.pinned ? 0 : b.pinned ? 1 : 0.5;
    const bShare = b.pinned ? 0 : a.pinned ? 1 : 0.5;
    if (overlapX < overlapY) {
      const shift = (dx < 0 ? -1 : 1) * overlapX;
      a.node.x -= shift * aShare;
      b.node.x += shift * bShare;
    } else {
      const shift = (dy < 0 ? -1 : 1) * overlapY;
      a.node.y -= shift * aShare;
      b.node.y += shift * bShare;
    }
  });
  for (const body of bodies) {
    if (!body.pinned) {
      body.node.y = Math.max(
        body.node.y,
        root.halfHeight + body.halfHeight + GAP,
      );
    }
  }
}

/**
 * Pair relaxation can leave residual overlaps in a dense graph. Freeze x and
 * sweep the solved y order once, moving each body below every earlier body
 * whose padded x interval intersects it. Earlier bodies never move again, so
 * this guarantees separation in O(V²), without an unbounded convergence loop
 * or introducing rows based on route depth. The root is first and stays pinned.
 */
function finishCollisions(bodies: Body[]): void {
  const ordered = [...bodies].sort(
    (a, b) => a.node.y - b.node.y || compare(a.node.uuid, b.node.uuid),
  );
  eachPair(ordered, (a, b) => {
    if (Math.abs(a.node.x - b.node.x) < a.halfWidth + b.halfWidth + GAP) {
      b.node.y = Math.max(
        b.node.y,
        a.node.y + a.halfHeight + b.halfHeight + GAP,
      );
    }
  });
}

function clampStep(value: number): number {
  return Math.max(-MAX_STEP, Math.min(MAX_STEP, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

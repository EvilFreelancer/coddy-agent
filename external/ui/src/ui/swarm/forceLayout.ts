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
/* Nominal vertical step per hop of the shortest route. It seeds the solver and
   anchors the weak depth spring, never a rigid row: two nodes at the same
   depth end up at different heights, which is what makes the map read as a
   graph flowing down rather than as tiers. */
const LEVEL = 170;
/* How strongly a node drifts back towards its depth's level. Weak on purpose:
   edges and repulsion win locally, so the pull shapes the flow without
   flattening it onto horizontal lines. */
const DEPTH_SPRING = 0.02;
/* Spread of the seeded x around the root axis, per level of depth. */
const SEED_SPREAD = 240;
const SEED_SPREAD_PER_DEPTH = 140;

type Body = {
  node: PlacedNode;
  halfWidth: number;
  halfHeight: number;
  /** The level this node's depth tends towards, deterministic jitter aside. */
  targetY: number;
  pinned: boolean;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
};

/**
 * A rooted graph layout, without timers or random state. Route depth only
 * seeds the positions and sets each node's weak vertical anchor; the solver
 * never snaps nodes onto hop rows, so the map flows downward as a directed
 * graph. Each of its 180 steps visits UUID-ordered pairs and edges, so a
 * poll's enumeration order does not change the result. After
 * O(V log V + E log E) sorting, the solver takes O(180 * (V² + E)) work and
 * O(V + E) storage.
 */
export function layoutTopologyGraph(
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
      // A weak pull towards the root's axis, and a softer one towards the
      // level of this node's route depth. The depth spring shapes a downward
      // flow; it never pins nodes to rows, so same-depth siblings keep the
      // spacing repulsion gives them.
      body.fx = -body.node.x * 0.002;
      body.fy = (body.targetY - body.node.y) * DEPTH_SPRING;
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
  const depth = Math.max(0, node.depth + lift);
  // Deterministic per-UUID jitter, so the placement cannot depend on input
  // order and two siblings at one depth never start on the same level.
  const spread =
    (hash / 0x100000000 - 0.5) * (SEED_SPREAD + depth * SEED_SPREAD_PER_DEPTH);
  const jitter = ((hash >> 8) & 63) - 32;
  const targetY = depth * LEVEL + jitter;
  return {
    node: {
      ...node,
      x: pinned ? 0 : spread,
      y: pinned ? 0 : targetY,
    },
    halfWidth: nodeHalfWidth(node),
    halfHeight: nodeHalfHeight(node),
    targetY,
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

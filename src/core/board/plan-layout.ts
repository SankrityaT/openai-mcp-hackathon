/**
 * Turns a model-produced mission plan into board geometry.
 *
 * Everything here has to survive untrusted plan shapes: the node graph comes
 * out of a language model, so `dependsOn` may name ids that do not exist, name
 * the node itself, or form a cycle. None of those may produce an infinite
 * loop, a NaN coordinate, or a node the canvas silently drops.
 */

export const NODE_WIDTH = 268;
export const NODE_HEIGHT = 164;
const COLUMN_GAP = 108;
const ROW_GAP = 40;
const ROOT_GAP = 150;

export const ROOT_ID = "__root__";

/**
 * Structural mirror of the harness's MissionPlan. Declared here rather than
 * imported so `core` keeps no dependency on `harness`; the harness type
 * satisfies it by shape.
 */
export type PlanNodeInput = {
  clientId: string;
  codename: string;
  roleLabel: string;
  objective: string;
  capabilityNames?: string[];
  dependsOn?: string[];
};

export type PlanInput = {
  title: string;
  summary: string;
  nodes: PlanNodeInput[];
  approvalBoundaries?: string[];
};

export type LaidOutNode = {
  id: string;
  codename: string;
  roleLabel: string;
  objective: string;
  capabilityNames: string[];
  dependsOn: string[];
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LaidOutEdge = { from: string; to: string };

export type BoardLayout = {
  title: string;
  summary: string;
  approvalBoundaries: string[];
  root: { id: string; x: number; y: number; width: number; height: number };
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  bounds: { x: number; y: number; width: number; height: number };
};

/**
 * Longest-path depth per node, with cycles broken at the back edge.
 *
 * Iterative depth-first rather than recursive so an adversarially deep plan
 * cannot overflow the stack. A dependency that is still being visited is a
 * back edge: it carries no ordering information, so it contributes nothing
 * instead of inflating depth on every pass around the loop.
 */
function computeDepths(ids: string[], dependsOn: Map<string, string[]>) {
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  for (const start of ids) {
    if (depth.has(start)) continue;
    const stack: { id: string; expanded: boolean }[] = [{ id: start, expanded: false }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edges = (dependsOn.get(frame.id) ?? []).filter(
        (dependency) => dependency !== frame.id && dependsOn.has(dependency),
      );

      if (!frame.expanded) {
        frame.expanded = true;
        visiting.add(frame.id);
        for (const dependency of edges) {
          if (!depth.has(dependency) && !visiting.has(dependency)) {
            stack.push({ id: dependency, expanded: false });
          }
        }
        continue;
      }

      stack.pop();
      visiting.delete(frame.id);
      let deepest = 0;
      for (const dependency of edges) {
        const resolved = depth.get(dependency);
        if (resolved !== undefined) deepest = Math.max(deepest, resolved + 1);
      }
      depth.set(frame.id, deepest);
    }
  }

  return depth;
}

export function layoutMissionPlan(plan: PlanInput): BoardLayout {
  // De-duplicate ids: two nodes claiming the same clientId would otherwise
  // stack on the exact same coordinates and read as one lost branch.
  const seen = new Set<string>();
  const nodes = plan.nodes.filter((node) => {
    if (!node.clientId || seen.has(node.clientId)) return false;
    seen.add(node.clientId);
    return true;
  });

  const ids = nodes.map((node) => node.clientId);
  const dependsOn = new Map(
    nodes.map((node) => [node.clientId, (node.dependsOn ?? []).filter((d) => d !== node.clientId)]),
  );
  const depth = computeDepths(ids, dependsOn);

  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id)!;
    const column = columns.get(d) ?? [];
    column.push(id);
    columns.set(d, column);
  }

  const position = new Map<string, { x: number; y: number }>();
  for (const [d, column] of columns) {
    const span = column.length * NODE_HEIGHT + (column.length - 1) * ROW_GAP;
    column.forEach((id, index) => {
      position.set(id, {
        x: d * (NODE_WIDTH + COLUMN_GAP),
        y: index * (NODE_HEIGHT + ROW_GAP) - span / 2 + NODE_HEIGHT / 2,
      });
    });
  }

  const laidOut: LaidOutNode[] = nodes.map((node) => {
    const point = position.get(node.clientId)!;
    return {
      id: node.clientId,
      codename: node.codename,
      roleLabel: node.roleLabel,
      objective: node.objective,
      capabilityNames: node.capabilityNames ?? [],
      dependsOn: dependsOn.get(node.clientId) ?? [],
      depth: depth.get(node.clientId)!,
      x: point.x,
      y: point.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  const root = {
    id: ROOT_ID,
    x: -(ROOT_GAP + NODE_WIDTH),
    y: -NODE_HEIGHT / 2,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  };

  const edges: LaidOutEdge[] = [];
  for (const node of laidOut) {
    const real = node.dependsOn.filter((d) => position.has(d));
    if (real.length === 0) {
      // A branch with no surviving dependency hangs off the mission itself.
      edges.push({ from: ROOT_ID, to: node.id });
      continue;
    }
    for (const dependency of real) edges.push({ from: dependency, to: node.id });
  }

  const boxes = [root, ...laidOut];
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));

  return {
    title: plan.title,
    summary: plan.summary,
    approvalBoundaries: plan.approvalBoundaries ?? [],
    root,
    nodes: laidOut,
    edges,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

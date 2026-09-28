export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Bounds = Point & Size;
export type GraphCamera = {
  x: number;
  y: number;
  scale: number;
  fitScale: number;
  userAdjusted: boolean;
};

type Geometry = {
  bounds: Bounds;
  viewport: Size;
  padding: number;
  fitScale: number;
};

const FALLBACK_CAMERA: GraphCamera = {
  x: 0,
  y: 0,
  scale: 1,
  fitScale: 1,
  userAdjusted: false,
};

export function fitCamera(
  bounds: Bounds,
  viewport: Size,
  padding: number,
): GraphCamera {
  const geometry = geometryFor(bounds, viewport, padding);
  if (!geometry) return { ...FALLBACK_CAMERA };

  const { fitScale } = geometry;
  return {
    x: centeredOffset(bounds.x, bounds.width, viewport.width, fitScale),
    y: centeredOffset(bounds.y, bounds.height, viewport.height, fitScale),
    scale: fitScale,
    fitScale,
    userAdjusted: false,
  };
}

export function zoomCameraAt(
  camera: GraphCamera,
  factor: number,
  focus: Point,
  bounds: Bounds,
  viewport: Size,
  padding: number,
): GraphCamera {
  const geometry = geometryFor(bounds, viewport, padding);
  if (!geometry) return { ...FALLBACK_CAMERA };

  const current = clampCamera(camera, bounds, viewport, padding);
  const scale = clamp(
    current.scale * positiveOr(factor, 1),
    geometry.fitScale,
    geometry.fitScale * 3,
  );
  const graph = graphPoint(current, focus);
  const safeFocus = finitePoint(focus);

  return clampCamera(
    {
      x: safeFocus.x - graph.x * scale,
      y: safeFocus.y - graph.y * scale,
      scale,
      fitScale: geometry.fitScale,
      userAdjusted: true,
    },
    bounds,
    viewport,
    padding,
  );
}

export function panCamera(
  camera: GraphCamera,
  dx: number,
  dy: number,
  bounds: Bounds,
  viewport: Size,
  padding: number,
): GraphCamera {
  const geometry = geometryFor(bounds, viewport, padding);
  if (!geometry) return { ...FALLBACK_CAMERA };

  const current = clampCamera(camera, bounds, viewport, padding);
  return clampCamera(
    {
      ...current,
      x: current.x + finiteOr(dx, 0),
      y: current.y + finiteOr(dy, 0),
      userAdjusted: true,
    },
    bounds,
    viewport,
    padding,
  );
}

export function clampCamera(
  camera: GraphCamera,
  bounds: Bounds,
  viewport: Size,
  padding: number,
): GraphCamera {
  const geometry = geometryFor(bounds, viewport, padding);
  if (!geometry) return { ...FALLBACK_CAMERA };

  const scale = clamp(
    positiveOr(camera.scale, geometry.fitScale),
    geometry.fitScale,
    geometry.fitScale * 3,
  );
  return {
    x: clampAxis(
      finiteOr(camera.x, 0),
      bounds.x,
      bounds.width,
      viewport.width,
      geometry.padding,
      scale,
    ),
    y: clampAxis(
      finiteOr(camera.y, 0),
      bounds.y,
      bounds.height,
      viewport.height,
      geometry.padding,
      scale,
    ),
    scale,
    fitScale: geometry.fitScale,
    userAdjusted: camera.userAdjusted === true,
  };
}

export function graphPoint(camera: GraphCamera, screen: Point): Point {
  const scale = positiveOr(camera.scale, 1);
  const point = finitePoint(screen);
  return {
    x: (point.x - finiteOr(camera.x, 0)) / scale,
    y: (point.y - finiteOr(camera.y, 0)) / scale,
  };
}

export function screenPoint(camera: GraphCamera, graph: Point): Point {
  const scale = positiveOr(camera.scale, 1);
  const point = finitePoint(graph);
  return {
    x: point.x * scale + finiteOr(camera.x, 0),
    y: point.y * scale + finiteOr(camera.y, 0),
  };
}

function geometryFor(
  bounds: Bounds,
  viewport: Size,
  padding: number,
): Geometry | null {
  if (
    !isFiniteNumber(bounds.x) ||
    !isFiniteNumber(bounds.y) ||
    !isPositive(bounds.width) ||
    !isPositive(bounds.height) ||
    !isPositive(viewport.width) ||
    !isPositive(viewport.height)
  ) {
    return null;
  }

  const safePadding = isFiniteNumber(padding) && padding >= 0 ? padding : 0;
  const availableWidth = viewport.width - safePadding * 2;
  const availableHeight = viewport.height - safePadding * 2;
  if (!isPositive(availableWidth) || !isPositive(availableHeight)) {
    return null;
  }

  const fitScale = Math.min(
    1,
    availableWidth / bounds.width,
    availableHeight / bounds.height,
  );
  if (!isPositive(fitScale)) return null;

  return { bounds, viewport, padding: safePadding, fitScale };
}

function clampAxis(
  offset: number,
  origin: number,
  size: number,
  viewportSize: number,
  padding: number,
  scale: number,
): number {
  const scaledSize = size * scale;
  if (scaledSize <= viewportSize) {
    return centeredOffset(origin, size, viewportSize, scale);
  }

  const min = viewportSize - padding - (origin + size) * scale;
  const max = padding - origin * scale;
  return clamp(offset, min, max);
}

function centeredOffset(
  origin: number,
  size: number,
  viewportSize: number,
  scale: number,
): number {
  return (viewportSize - size * scale) / 2 - origin * scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finitePoint(point: Point): Point {
  return { x: finiteOr(point.x, 0), y: finiteOr(point.y, 0) };
}

function positiveOr(value: number, fallback: number): number {
  return isPositive(value) ? value : fallback;
}

function finiteOr(value: number, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function isPositive(value: number): boolean {
  return isFiniteNumber(value) && value > 0;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

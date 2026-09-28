import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  fitCamera,
  panCamera,
  zoomCameraAt,
  type Bounds,
  type GraphCamera,
  type Point,
  type Size,
} from "./graphViewport";

const PADDING = 24;
const ZOOM_FACTOR = 1.2;
const WHEEL_DOUBLING_PX = 500;
const DRAG_SLOP_PX = 4;

const INITIAL_CAMERA: GraphCamera = {
  x: 0,
  y: 0,
  scale: 1,
  fitScale: 1,
  userAdjusted: false,
};

type GesturePoint = Point & { clientX: number; clientY: number };

type PanGesture = {
  id: number;
  start: GesturePoint;
  last: GesturePoint;
};

type PinchGesture = {
  span: number;
  camera: GraphCamera;
};

/**
 * Holds the SVG camera and the gestures that move it. The graph geometry stays
 * pure in graphViewport; this hook is the DOM boundary that supplies viewport
 * sizes and browser events.
 */
export function useGraphViewport(props: { bounds: Bounds; resetKey: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<GraphCamera>(INITIAL_CAMERA);
  const [camera, setCamera] = useState<GraphCamera>(INITIAL_CAMERA);
  const [isPanning, setIsPanning] = useState(false);
  const pointersRef = useRef(new Map<number, GesturePoint>());
  const panRef = useRef<PanGesture | null>(null);
  const pinchRef = useRef<PinchGesture | null>(null);
  const consumedGestureClickRef = useRef(false);

  const geometry = useCallback((): Size | null => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { width: rect.width, height: rect.height };
  }, []);

  const updateCamera = useCallback((next: GraphCamera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);

  const fit = useCallback(() => {
    const viewport = geometry();
    if (!viewport) return;
    updateCamera(fitCamera(props.bounds, viewport, PADDING));
  }, [geometry, props.bounds, updateCamera]);

  const zoomAt = useCallback(
    (factor: number, focus?: Point) => {
      const viewport = geometry();
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!viewport || !rect) return;
      updateCamera(
        zoomCameraAt(
          cameraRef.current,
          factor,
          focus ?? { x: rect.width / 2, y: rect.height / 2 },
          props.bounds,
          viewport,
          PADDING,
        ),
      );
    },
    [geometry, props.bounds, updateCamera],
  );

  const zoomIn = useCallback(() => zoomAt(ZOOM_FACTOR), [zoomAt]);
  const zoomOut = useCallback(() => zoomAt(1 / ZOOM_FACTOR), [zoomAt]);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const viewport = geometry();
      if (!viewport) return;
      updateCamera(
        panCamera(cameraRef.current, dx, dy, props.bounds, viewport, PADDING),
      );
    },
    [geometry, props.bounds, updateCamera],
  );

  // A relay or layout mode describes a different picture. Polls do not: a
  // manual camera must remain where the reader left it across ordinary reads.
  useLayoutEffect(() => {
    fit();
  }, [fit, props.resetKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => {
      if (!cameraRef.current.userAdjusted) fit();
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(viewport);
    resize();
    return () => observer?.disconnect();
  }, [fit]);

  // A native non-passive listener is required: React may attach wheel handlers
  // passively, in which case the browser scrolls the page behind the canvas.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pixels =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * rect.height
            : event.deltaY;
      zoomAt(Math.pow(2, -pixels / WHEEL_DOUBLING_PX), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  const pointFor = (event: PointerEvent<HTMLDivElement>): GesturePoint => ({
    x: event.clientX,
    y: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY,
  });

  const pointerPair = (): [GesturePoint, GesturePoint] | null => {
    const points = [...pointersRef.current.values()];
    return points.length >= 2 ? [points[0]!, points[1]!] : null;
  };

  const startPinch = () => {
    const pair = pointerPair();
    if (!pair) return;
    panRef.current = null;
    setIsPanning(false);
    consumedGestureClickRef.current = true;
    pinchRef.current = {
      span: span(pair[0], pair[1]),
      camera: cameraRef.current,
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = pointFor(event);
    pointersRef.current.set(event.pointerId, point);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A browser can end a pointer before capture reaches it.
    }
    if (pointersRef.current.size >= 2) {
      startPinch();
      event.preventDefault();
      return;
    }
    consumedGestureClickRef.current = false;
    panRef.current = { id: event.pointerId, start: point, last: point };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = pointFor(event);
    pointersRef.current.set(event.pointerId, point);
    const pinch = pinchRef.current;
    const pair = pointerPair();
    if (pinch && pair) {
      event.preventDefault();
      const rect = viewportRef.current?.getBoundingClientRect();
      const viewport = geometry();
      if (!rect || !viewport || pinch.span <= 0) return;
      const middle = midpoint(pair[0], pair[1]);
      updateCamera(
        zoomCameraAt(
          pinch.camera,
          span(pair[0], pair[1]) / pinch.span,
          { x: middle.x - rect.left, y: middle.y - rect.top },
          props.bounds,
          viewport,
          PADDING,
        ),
      );
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.id !== event.pointerId) return;
    const movedX = point.x - pan.start.x;
    const movedY = point.y - pan.start.y;
    if (Math.hypot(movedX, movedY) >= DRAG_SLOP_PX) {
      consumedGestureClickRef.current = true;
      setIsPanning(true);
      event.preventDefault();
      panBy(point.x - pan.last.x, point.y - pan.last.y);
    }
    pan.last = point;
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture can be released alongside the pointer itself.
    }
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (panRef.current?.id === event.pointerId) panRef.current = null;
    setIsPanning(false);
    const rest = [...pointersRef.current.entries()];
    if (rest.length === 1) {
      const [id, point] = rest[0]!;
      panRef.current = { id, start: point, last: point };
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomIn();
    } else if (event.key === "-") {
      event.preventDefault();
      zoomOut();
    } else if (event.key === "0") {
      event.preventDefault();
      fit();
    }
  };

  const consumeGestureClick = (): boolean => {
    if (!consumedGestureClickRef.current) return false;
    consumedGestureClickRef.current = false;
    return true;
  };

  return {
    viewportRef,
    transform: `translate(${camera.x} ${camera.y}) scale(${camera.scale})`,
    isPanning,
    fit,
    zoomIn,
    zoomOut,
    stageProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onKeyDown,
    },
    consumeGestureClick,
    userAdjusted: camera.userAdjusted,
  };
}

function span(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

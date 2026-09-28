import { describe, expect, it } from "vitest";
import {
  clampCamera,
  fitCamera,
  graphPoint,
  panCamera,
  screenPoint,
  zoomCameraAt,
  type Bounds,
  type GraphCamera,
  type Point,
  type Size,
} from "./graphViewport";

const bounds: Bounds = { x: 0, y: 0, width: 1000, height: 500 };
const viewport: Size = { width: 500, height: 300 };
const padding = 20;

function expectFinite(camera: GraphCamera): void {
  for (const value of Object.values(camera)) {
    if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  }
}

describe("graph viewport camera math", () => {
  it("fits a graph within padding and maps its center to the viewport center", () => {
    const camera = fitCamera(bounds, viewport, padding);

    expect(camera.fitScale).toBeCloseTo(0.46);
    expect(camera.scale).toBeCloseTo(0.46);
    expect(screenPoint(camera, { x: 500, y: 250 })).toEqual({
      x: 250,
      y: 150,
    });
  });

  it("does not enlarge a graph that already fits", () => {
    const camera = fitCamera(
      { x: 0, y: 0, width: 100, height: 50 },
      viewport,
      padding,
    );

    expect(camera.fitScale).toBe(1);
    expect(camera.scale).toBe(1);
  });

  it("treats invalid padding as zero", () => {
    const camera = fitCamera(bounds, viewport, Number.NaN);

    expect(camera.fitScale).toBeCloseTo(0.5);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(25);
  });

  it("keeps the graph point beneath the zoom focus fixed", () => {
    const camera = fitCamera(bounds, viewport, padding);
    const focus: Point = { x: 250, y: 150 };
    const before = graphPoint(camera, focus);
    const zoomed = zoomCameraAt(camera, 2, focus, bounds, viewport, padding);

    expect(graphPoint(zoomed, focus).x).toBeCloseTo(before.x);
    expect(graphPoint(zoomed, focus).y).toBeCloseTo(before.y);
  });

  it("clamps zoom scale between the fit scale and three times that scale", () => {
    const camera = fitCamera(bounds, viewport, padding);

    expect(
      zoomCameraAt(camera, 0.01, { x: 250, y: 150 }, bounds, viewport, padding)
        .scale,
    ).toBeCloseTo(camera.fitScale);
    expect(
      zoomCameraAt(camera, 100, { x: 250, y: 150 }, bounds, viewport, padding)
        .scale,
    ).toBeCloseTo(camera.fitScale * 3);
  });

  it("clamps panning to padded content bounds and centers a smaller axis", () => {
    const wideButShort: Bounds = { x: 0, y: 0, width: 1000, height: 100 };
    const camera: GraphCamera = {
      x: -100,
      y: 0,
      scale: 1,
      fitScale: fitCamera(wideButShort, viewport, padding).fitScale,
      userAdjusted: false,
    };

    const right = panCamera(camera, 10000, 50, wideButShort, viewport, padding);
    expect(right.x).toBe(20);
    expect(right.y).toBe(100);

    const left = panCamera(right, -10000, -50, wideButShort, viewport, padding);
    expect(left.x).toBe(-520);
    expect(left.y).toBe(100);
  });

  it("returns a finite fallback camera for invalid or nonfinite geometry", () => {
    const invalid: Bounds = {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      width: 0,
      height: Number.NaN,
    };
    const invalidViewport: Size = {
      width: Number.NEGATIVE_INFINITY,
      height: 0,
    };
    const invalidCamera: GraphCamera = {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      scale: Number.NaN,
      fitScale: 0,
      userAdjusted: true,
    };

    expect(fitCamera(invalid, invalidViewport, Number.NaN)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      fitScale: 1,
      userAdjusted: false,
    });
    expectFinite(
      clampCamera(invalidCamera, invalid, invalidViewport, Infinity),
    );
    expectFinite(
      zoomCameraAt(
        invalidCamera,
        Number.NaN,
        { x: Infinity, y: Number.NaN },
        invalid,
        invalidViewport,
        Number.NEGATIVE_INFINITY,
      ),
    );
    expectFinite(
      panCamera(
        invalidCamera,
        Infinity,
        Number.NaN,
        invalid,
        invalidViewport,
        Number.NaN,
      ),
    );
  });

  it("marks fit cameras untouched and zoomed or panned cameras adjusted", () => {
    const fitted = fitCamera(bounds, viewport, padding);

    expect(fitted.userAdjusted).toBe(false);
    expect(
      zoomCameraAt(fitted, 2, { x: 250, y: 150 }, bounds, viewport, padding)
        .userAdjusted,
    ).toBe(true);
    expect(
      panCamera(fitted, 10, 10, bounds, viewport, padding).userAdjusted,
    ).toBe(true);
  });

  it("converts finite graph and screen coordinates inversely", () => {
    const camera: GraphCamera = {
      x: -120,
      y: 40,
      scale: 0.75,
      fitScale: 0.5,
      userAdjusted: true,
    };
    const graph: Point = { x: 900.25, y: -125.5 };
    const screen = screenPoint(camera, graph);

    expect(graphPoint(camera, screen).x).toBeCloseTo(graph.x);
    expect(graphPoint(camera, screen).y).toBeCloseTo(graph.y);
  });
});

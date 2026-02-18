import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { compareImages, ImageCompareError } from "../src/agent/image-compare.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-compare-"));
  tempDirs.push(dir);
  return dir;
}

function writePng(
  filePath: string,
  width: number,
  height: number,
  fillPixel: (x: number, y: number) => [number, number, number, number],
): void {
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      const [r, g, b, a] = fillPixel(x, y);
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }

  fs.writeFileSync(filePath, PNG.sync.write(png));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("compareImages", () => {
  it("returns zero error metrics for identical images", () => {
    const root = createTempDir();
    const actualPath = path.join(root, "actual.png");
    const referencePath = path.join(root, "reference.png");

    writePng(actualPath, 2, 2, () => [100, 150, 200, 255]);
    writePng(referencePath, 2, 2, () => [100, 150, 200, 255]);

    const result = compareImages({
      actualImagePath: actualPath,
      referenceImagePath: referencePath,
      writeDiff: true,
      dimensionPolicy: "strict",
      resizeInterpolation: "bilinear",
    });

    expect(result.metrics.maeRgb).toBe(0);
    expect(result.metrics.maeLuminance).toBe(0);
    expect(result.metrics.diffPixels).toBe(0);
    expect(result.metrics.percentDiffPixels).toBe(0);
    expect(result.diffPng).not.toBeNull();
  });

  it("returns non-zero error metrics when images differ", () => {
    const root = createTempDir();
    const actualPath = path.join(root, "actual.png");
    const referencePath = path.join(root, "reference.png");

    writePng(actualPath, 2, 2, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 255] : [100, 100, 100, 255]));
    writePng(referencePath, 2, 2, () => [100, 100, 100, 255]);

    const result = compareImages({
      actualImagePath: actualPath,
      referenceImagePath: referencePath,
      writeDiff: true,
      dimensionPolicy: "strict",
      resizeInterpolation: "bilinear",
    });

    expect(result.metrics.maeRgb).toBeGreaterThan(0);
    expect(result.metrics.maeLuminance).toBeGreaterThan(0);
    expect(result.metrics.diffPixels).toBe(1);
    expect(result.metrics.percentDiffPixels).toBe(25);
    expect(result.diffPng).not.toBeNull();
  });

  it("throws IMAGE_DIMENSION_MISMATCH for different image sizes", () => {
    const root = createTempDir();
    const actualPath = path.join(root, "actual.png");
    const referencePath = path.join(root, "reference.png");

    writePng(actualPath, 2, 2, () => [100, 100, 100, 255]);
    writePng(referencePath, 1, 1, () => [100, 100, 100, 255]);

    expect(() =>
      compareImages({
        actualImagePath: actualPath,
        referenceImagePath: referencePath,
        writeDiff: true,
        dimensionPolicy: "strict",
        resizeInterpolation: "bilinear",
      }),
    ).toThrowError(ImageCompareError);

    try {
      compareImages({
        actualImagePath: actualPath,
        referenceImagePath: referencePath,
        writeDiff: true,
        dimensionPolicy: "strict",
        resizeInterpolation: "bilinear",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ImageCompareError);
      expect((error as ImageCompareError).code).toBe("IMAGE_DIMENSION_MISMATCH");
    }
  });

  it("auto-resizes reference image when dimension policy is resize-reference-to-actual", () => {
    const root = createTempDir();
    const actualPath = path.join(root, "actual.png");
    const referencePath = path.join(root, "reference.png");

    writePng(actualPath, 2, 2, (x, y) => (x === y ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    writePng(referencePath, 1, 1, () => [255, 255, 255, 255]);

    const result = compareImages({
      actualImagePath: actualPath,
      referenceImagePath: referencePath,
      writeDiff: true,
      dimensionPolicy: "resize-reference-to-actual",
      resizeInterpolation: "nearest",
    });

    expect(result.metrics.width).toBe(2);
    expect(result.metrics.height).toBe(2);
    expect(result.metrics.resizeApplied).toBe(true);
    expect(result.metrics.originalReferenceWidth).toBe(1);
    expect(result.metrics.originalReferenceHeight).toBe(1);
  });
});

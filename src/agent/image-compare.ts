import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export type ImageCompareErrorCode =
  | "FILE_NOT_FOUND"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "IMAGE_DIMENSION_MISMATCH";

export class ImageCompareError extends Error {
  readonly code: ImageCompareErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: ImageCompareErrorCode,
    message: string,
    options: {
      statusCode: number;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.code = code;
    this.statusCode = options.statusCode;
    this.details = options.details ?? {};
  }
}

type DecodedImage = {
  width: number;
  height: number;
  data: Uint8Array;
  format: "png" | "jpeg";
};

type DimensionPolicy = "strict" | "resize-reference-to-actual";
type ResizeInterpolation = "nearest" | "bilinear";

export type ImageCompareOptions = {
  actualImagePath: string;
  referenceImagePath: string;
  writeDiff: boolean;
  dimensionPolicy: DimensionPolicy;
  resizeInterpolation: ResizeInterpolation;
};

export type ImageCompareMetrics = {
  width: number;
  height: number;
  totalPixels: number;
  diffPixels: number;
  percentDiffPixels: number;
  maeRgb: number;
  maeLuminance: number;
  resizeApplied: boolean;
  originalReferenceWidth: number;
  originalReferenceHeight: number;
};

export type ImageCompareResult = {
  actualResolvedPath: string;
  referenceResolvedPath: string;
  actualFormat: "png" | "jpeg";
  referenceFormat: "png" | "jpeg";
  metrics: ImageCompareMetrics;
  actualPng: Buffer;
  referencePng: Buffer;
  diffPng: Buffer | null;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function resolveAndCheckPath(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  if (!fs.existsSync(resolved)) {
    throw new ImageCompareError("FILE_NOT_FOUND", `Image file not found: ${resolved}`, {
      statusCode: 404,
      details: { path: resolved },
    });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new ImageCompareError("FILE_NOT_FOUND", `Image path is not a file: ${resolved}`, {
      statusCode: 404,
      details: { path: resolved },
    });
  }

  return resolved;
}

function decodeImageBuffer(buffer: Buffer): DecodedImage {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(PNG_SIGNATURE)) {
    try {
      const decoded = PNG.sync.read(buffer);
      return {
        width: decoded.width,
        height: decoded.height,
        data: decoded.data,
        format: "png",
      };
    } catch (error) {
      throw new ImageCompareError("UNSUPPORTED_IMAGE_FORMAT", "Unable to decode PNG image", {
        statusCode: 422,
        details: { reason: String(error) },
      });
    }
  }

  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(JPEG_SIGNATURE)) {
    try {
      const decoded = jpeg.decode(buffer, { useTArray: true });
      return {
        width: decoded.width,
        height: decoded.height,
        data: decoded.data,
        format: "jpeg",
      };
    } catch (error) {
      throw new ImageCompareError("UNSUPPORTED_IMAGE_FORMAT", "Unable to decode JPEG image", {
        statusCode: 422,
        details: { reason: String(error) },
      });
    }
  }

  throw new ImageCompareError("UNSUPPORTED_IMAGE_FORMAT", "Only PNG and JPEG image formats are supported", {
    statusCode: 422,
  });
}

function readImageFromPath(rawPath: string): { resolvedPath: string; image: DecodedImage } {
  const resolvedPath = resolveAndCheckPath(rawPath);
  const buffer = fs.readFileSync(resolvedPath);
  return {
    resolvedPath,
    image: decodeImageBuffer(buffer),
  };
}

function encodePng(width: number, height: number, rgbaData: Uint8Array): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgbaData);
  return PNG.sync.write(png);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resizeNearest(image: DecodedImage, targetWidth: number, targetHeight: number): Uint8Array {
  const resized = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(image.height - 1, Math.floor((y * image.height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(image.width - 1, Math.floor((x * image.width) / targetWidth));
      const srcIdx = (srcY * image.width + srcX) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      resized[dstIdx] = image.data[srcIdx] ?? 0;
      resized[dstIdx + 1] = image.data[srcIdx + 1] ?? 0;
      resized[dstIdx + 2] = image.data[srcIdx + 2] ?? 0;
      resized[dstIdx + 3] = image.data[srcIdx + 3] ?? 255;
    }
  }
  return resized;
}

function resizeBilinear(image: DecodedImage, targetWidth: number, targetHeight: number): Uint8Array {
  const resized = new Uint8Array(targetWidth * targetHeight * 4);
  const maxX = image.width - 1;
  const maxY = image.height - 1;

  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = ((y + 0.5) * image.height) / targetHeight - 0.5;
    const y0 = clamp(Math.floor(srcY), 0, maxY);
    const y1 = clamp(y0 + 1, 0, maxY);
    const wy = clamp(srcY - y0, 0, 1);

    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = ((x + 0.5) * image.width) / targetWidth - 0.5;
      const x0 = clamp(Math.floor(srcX), 0, maxX);
      const x1 = clamp(x0 + 1, 0, maxX);
      const wx = clamp(srcX - x0, 0, 1);
      const dstIdx = (y * targetWidth + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = image.data[(y0 * image.width + x0) * 4 + channel] ?? 0;
        const topRight = image.data[(y0 * image.width + x1) * 4 + channel] ?? 0;
        const bottomLeft = image.data[(y1 * image.width + x0) * 4 + channel] ?? 0;
        const bottomRight = image.data[(y1 * image.width + x1) * 4 + channel] ?? 0;

        const top = topLeft * (1 - wx) + topRight * wx;
        const bottom = bottomLeft * (1 - wx) + bottomRight * wx;
        resized[dstIdx + channel] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }

  return resized;
}

function resizeImage(
  image: DecodedImage,
  targetWidth: number,
  targetHeight: number,
  interpolation: ResizeInterpolation,
): DecodedImage {
  if (image.width === targetWidth && image.height === targetHeight) {
    return image;
  }

  const data =
    interpolation === "nearest"
      ? resizeNearest(image, targetWidth, targetHeight)
      : resizeBilinear(image, targetWidth, targetHeight);

  return {
    width: targetWidth,
    height: targetHeight,
    data,
    format: image.format,
  };
}

export function compareImages(options: ImageCompareOptions): ImageCompareResult {
  const actual = readImageFromPath(options.actualImagePath);
  const reference = readImageFromPath(options.referenceImagePath);
  const originalReferenceWidth = reference.image.width;
  const originalReferenceHeight = reference.image.height;

  let normalizedReference = reference.image;
  let resizeApplied = false;

  if (actual.image.width !== reference.image.width || actual.image.height !== reference.image.height) {
    if (options.dimensionPolicy === "resize-reference-to-actual") {
      normalizedReference = resizeImage(
        reference.image,
        actual.image.width,
        actual.image.height,
        options.resizeInterpolation,
      );
      resizeApplied = true;
    } else {
      throw new ImageCompareError("IMAGE_DIMENSION_MISMATCH", "Image dimensions must match for comparison", {
        statusCode: 422,
        details: {
          actual: { width: actual.image.width, height: actual.image.height },
          reference: { width: reference.image.width, height: reference.image.height },
        },
      });
    }
  }

  const width = actual.image.width;
  const height = actual.image.height;
  const totalPixels = width * height;
  const diffData = new Uint8Array(actual.image.data.length);

  let sumAbsRgb = 0;
  let sumAbsLuma = 0;
  let diffPixels = 0;

  for (let idx = 0; idx < actual.image.data.length; idx += 4) {
    const ar = actual.image.data[idx] ?? 0;
    const ag = actual.image.data[idx + 1] ?? 0;
    const ab = actual.image.data[idx + 2] ?? 0;
    const aa = actual.image.data[idx + 3] ?? 255;

    const rr = normalizedReference.data[idx] ?? 0;
    const rg = normalizedReference.data[idx + 1] ?? 0;
    const rb = normalizedReference.data[idx + 2] ?? 0;

    const dr = Math.abs(ar - rr);
    const dg = Math.abs(ag - rg);
    const db = Math.abs(ab - rb);

    sumAbsRgb += dr + dg + db;
    sumAbsLuma += Math.abs(LUMA_R * ar + LUMA_G * ag + LUMA_B * ab - (LUMA_R * rr + LUMA_G * rg + LUMA_B * rb));

    if (dr > 0 || dg > 0 || db > 0) {
      diffPixels += 1;
    }

    diffData[idx] = dr;
    diffData[idx + 1] = dg;
    diffData[idx + 2] = db;
    diffData[idx + 3] = aa;
  }

  const maeRgb = totalPixels === 0 ? 0 : sumAbsRgb / (totalPixels * 3 * 255);
  const maeLuminance = totalPixels === 0 ? 0 : sumAbsLuma / (totalPixels * 255);
  const percentDiffPixels = totalPixels === 0 ? 0 : (diffPixels / totalPixels) * 100;

  return {
    actualResolvedPath: actual.resolvedPath,
    referenceResolvedPath: reference.resolvedPath,
    actualFormat: actual.image.format,
    referenceFormat: reference.image.format,
    metrics: {
      width,
      height,
      totalPixels,
      diffPixels,
      percentDiffPixels,
      maeRgb,
      maeLuminance,
      resizeApplied,
      originalReferenceWidth,
      originalReferenceHeight,
    },
    actualPng: encodePng(width, height, actual.image.data),
    referencePng: encodePng(width, height, normalizedReference.data),
    diffPng: options.writeDiff ? encodePng(width, height, diffData) : null,
  };
}

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

export type ImageCompareOptions = {
  actualImagePath: string;
  referenceImagePath: string;
  writeDiff: boolean;
};

export type ImageCompareMetrics = {
  width: number;
  height: number;
  totalPixels: number;
  diffPixels: number;
  percentDiffPixels: number;
  maeRgb: number;
  maeLuminance: number;
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

export function compareImages(options: ImageCompareOptions): ImageCompareResult {
  const actual = readImageFromPath(options.actualImagePath);
  const reference = readImageFromPath(options.referenceImagePath);

  if (actual.image.width !== reference.image.width || actual.image.height !== reference.image.height) {
    throw new ImageCompareError("IMAGE_DIMENSION_MISMATCH", "Image dimensions must match for comparison", {
      statusCode: 422,
      details: {
        actual: { width: actual.image.width, height: actual.image.height },
        reference: { width: reference.image.width, height: reference.image.height },
      },
    });
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

    const rr = reference.image.data[idx] ?? 0;
    const rg = reference.image.data[idx + 1] ?? 0;
    const rb = reference.image.data[idx + 2] ?? 0;

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
    },
    actualPng: encodePng(width, height, actual.image.data),
    referencePng: encodePng(width, height, reference.image.data),
    diffPng: options.writeDiff ? encodePng(width, height, diffData) : null,
  };
}

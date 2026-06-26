class TestCanvasContext2D {
  font = "400 16px Arial";

  measureText(text: string): TextMetrics {
    const size = fontSize(this.font);
    let width = 0;
    for (const char of text) {
      width += charWidth(char, size);
    }
    return { width } as TextMetrics;
  }
}

class TestOffscreenCanvas {
  constructor(_width: number, _height: number) {}

  getContext(type: string): TestCanvasContext2D | null {
    return type === "2d" ? new TestCanvasContext2D() : null;
  }
}

if (typeof globalThis.OffscreenCanvas === "undefined") {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas =
    TestOffscreenCanvas;
}

function fontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number(match[1]) : 16;
}

function charWidth(char: string, size: number): number {
  if (char === "\t") return size * 2.4;
  if (/\s/.test(char)) return size * 0.32;
  if (/[\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/.test(char)) {
    return size * 0.92;
  }
  if (/[A-Z0-9]/.test(char)) return size * 0.62;
  if (/[.,:;|()[\]{}'"`]/.test(char)) return size * 0.34;
  return size * 0.54;
}

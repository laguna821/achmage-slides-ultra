// Obsidian's desktop renderer provides these Node builtins at runtime. Keep a
// minimal declaration surface in the source tree because the Community
// Dashboard can type-check plugin source without automatically loading
// @types/node. The direct imports and filesystem capability remain visible.

declare module "node:crypto" {
  interface Hash {
    update(data: string | Uint8Array | Uint8ClampedArray): this;
    digest(encoding: "hex"): string;
  }

  export function createHash(algorithm: string): Hash;
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  interface BigIntFileStat {
    readonly size: bigint;
    readonly dev: bigint;
    readonly ino: bigint;
    readonly nlink: bigint;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }

  interface FileHandle {
    stat(options: { bigint: true }): Promise<BigIntFileStat>;
    write(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number
    ): Promise<{ readonly bytesWritten: number }>;
    read(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number
    ): Promise<{ readonly bytesRead: number }>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }

  export function open(
    path: string,
    flags?: string | number,
    mode?: string | number
  ): Promise<FileHandle>;
  export function lstat(
    path: string,
    options: { bigint: true }
  ): Promise<BigIntFileStat>;
  export function link(existingPath: string, newPath: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
}

import { FileSystemAdapter, Plugin, requestUrl } from "obsidian";
import {
  type AchmageSettings,
  DEFAULT_SETTINGS,
  AchmageSettingTab,
} from "./settings";
import { TIER3_R2_DEFAULTS } from "./settingsDefaults";
import { SlideRenderer } from "./engine/slideRenderer";
import { SlidePreviewView, SLIDE_VIEW_TYPE } from "./view/slidePreviewView";
import {
  PRETENDARD_WOFF2_DATAURL,
  JETBRAINS_MONO_WOFF2_DATAURL,
} from "./assets/fonts.generated";
import {
  AUDIT_MAX_PASSES,
  AUDIT_SHRINK_MARGIN,
  AUDIT_TOLERANCE_PX,
  auditedRenderOffscreen,
} from "./audit/auditLoop";

export default class AchmageSlides extends Plugin {
  settings: AchmageSettings = DEFAULT_SETTINGS;
  // v8.0 — onload에서 실제 설정으로 1회만 생성한다(아래 onload L참조). 필드 기본값으로
  // SlideRenderer를 만들면 marp-core가 onload 전 1회 + onload에서 1회 = 2회 초기화돼
  // 로드 비용이 배가된다(첫 인스턴스는 render 없이 즉시 버려짐). definite-assignment(!)로
  // 인스턴스 생성을 제거 — onload 이후에만 참조되므로(view/command/settingTab 경로) 안전.
  renderer!: SlideRenderer;

  async onload(): Promise<void> {
    this.injectBundledFonts();
    await this.loadSettings();
    this.renderer = new SlideRenderer(this.settings);
    // v7.0 — 로컬 override 이미지를 미리 data URI로 읽어 렌더러에 주입(있을 때만).
    await this.resolveTier3Overrides();

    // Register the slide preview view
    this.registerView(SLIDE_VIEW_TYPE, (leaf) => new SlidePreviewView(leaf, this));

    // Command: Open slide preview
    this.addCommand({
      id: "open-slide-preview",
      name: "Open slide preview",
      callback: () => this.activateSlideView(),
    });

    // Command: Export current file as HTML slides
    this.addCommand({
      id: "export-html",
      name: "Export slides as HTML",
      callback: () => this.exportCurrentFileAsHTML(),
    });

    // PR3 — bind +/- to base font size from anywhere. Default hotkey is left
    // unset (Obsidian convention) so the user maps a shortcut via Settings →
    // Hotkeys to whatever doesn't conflict with their workflow. The Type
    // Quick Controls popover (slidePreviewView) covers the in-toolbar path.
    this.addCommand({
      id: "increase-base-font-size",
      name: "Increase base font size (1pt)",
      callback: async () => {
        const next = Math.min(40, this.settings.baseFontSize + 1);
        if (next !== this.settings.baseFontSize) {
          this.settings.baseFontSize = next;
          await this.saveSettings();
        }
      },
    });
    this.addCommand({
      id: "decrease-base-font-size",
      name: "Decrease base font size (1pt)",
      callback: async () => {
        const next = Math.max(16, this.settings.baseFontSize - 1);
        if (next !== this.settings.baseFontSize) {
          this.settings.baseFontSize = next;
          await this.saveSettings();
        }
      },
    });

    // Add settings tab
    this.addSettingTab(new AchmageSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon("presentation", "Open Achmage Slides", () => {
      void this.activateSlideView();
    });
  }

  /**
   * Register the bundled fonts on the MAIN Obsidian document via the FontFace
   * API. The slide iframe gets the faces through the theme CSS (themeRegistry),
   * but the canvas text-measurer (PretextMeasurementEngine) runs in the main
   * renderer document — without the faces here it measures on a fallback face
   * and overflow prediction drifts from the actual Pretendard render. We use
   * FontFace + activeDocument.fonts (not a <style> element, which the plugin
   * guidelines disallow); kicking off the loads pins the first measurement to
   * the real face. The faces are unregistered on unload via this.register.
   */
  private injectBundledFonts(): void {
    const fonts = activeDocument.fonts;
    let registered = false;
    fonts.forEach((f) => {
      if (f.family === "Pretendard Variable") registered = true;
    });
    if (registered) return;

    const faces = [
      new FontFace("Pretendard Variable", `url(${PRETENDARD_WOFF2_DATAURL})`, {
        weight: "100 900",
        display: "block",
      }),
      new FontFace("JetBrains Mono", `url(${JETBRAINS_MONO_WOFF2_DATAURL})`, {
        weight: "100 800",
        display: "block",
      }),
    ];
    for (const face of faces) {
      void face.load().then(
        (loaded) => fonts.add(loaded),
        () => {
          /* font load failure → measurement falls back, render unaffected */
        }
      );
      this.register(() => fonts.delete(face));
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<AchmageSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    let changed = false;

    // native 1920 v5 has one supported default baseline.
    const loadedVersion =
      typeof loaded?.settingsVersion === "number" ? loaded.settingsVersion : 0;
    if (loadedVersion < 5) {
      this.settings.defaultTheme = "cmds-dark-native-1920-v5";
      this.settings.settingsVersion = 5;
      changed = true;
    }
    // PR3 (quirky-hopping-journal, 2026-05-18) — Step 1 dropped 14 dead +
    // 1 partial settings (atlas-era keys whose consumers were removed in
    // PR1 majestic-eagle). Old user data may still carry those keys; they
    // sit dormant in the saved JSON since nothing reads them anymore. We
    // only bump the version stamp here — no field strip — to keep the
    // migration trivially reversible.
    if (loadedVersion < 6) {
      this.settings.settingsVersion = 6;
      changed = true;
    }
    // v5.6 (hallym-light) — light theme becomes the default. Flip users still
    // on the legacy forced baseline (cmds-dark, set by the < 5 block above) to
    // the new light default; users who deliberately picked another theme keep
    // their choice. Reversible any time via Settings → Default theme.
    if (loadedVersion < 7) {
      if (this.settings.defaultTheme === "cmds-dark-native-1920-v5") {
        this.settings.defaultTheme = "hallym-light";
      }
      this.settings.settingsVersion = 7;
      changed = true;
    }
    // v7.0 — Tier 3 필드 도입. 새 키는 Object.assign(DEFAULT_SETTINGS, loaded)로
    // 이미 안전한 기본값을 받으므로 필드 스트립/이전 없이 버전 스탬프만 올린다.
    if (loadedVersion < 8) {
      this.settings.settingsVersion = 8;
      changed = true;
    }
    // v7.0 — Tier 3 배경 R2 기본값 도입. 기존 설치는 tier3BgOverrides가 비어/부분이라
    // 빠진 테마만 R2 기본 URL로 채운다(사용자가 직접 넣은 값은 보존).
    if (loadedVersion < 9) {
      if (!this.settings.tier3BgOverrides) this.settings.tier3BgOverrides = {};
      for (const [k, v] of Object.entries(TIER3_R2_DEFAULTS)) {
        if (!this.settings.tier3BgOverrides[k]) {
          this.settings.tier3BgOverrides[k] = v;
        }
      }
      this.settings.settingsVersion = 9;
      changed = true;
    }

    if (changed) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.renderer.updateSettings(this.settings);
    // v7.0 — override 입력이 바뀌었을 수 있으니 로컬 이미지를 다시 해석한 뒤 재렌더.
    await this.resolveTier3Overrides();
    // Force re-render of any open slide preview so settings changes
    // (typography, theme, layout) take effect immediately.
    this.app.workspace.getLeavesOfType(SLIDE_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof SlidePreviewView) {
        view.refresh();
      }
    });
  }

  /**
   * v7.0 — Tier 3 배경의 로컬 파일 override를 미리 읽어 data URI로 만들어 렌더러에
   * 주입한다. https/data/app override는 렌더러가 직접 통과시키므로 건너뛴다. 로컬은
   * data URI로 바꿔야 (1) 플러그인 폴더처럼 vault 일반 파일 목록에 없는 위치도 읽히고
   * (2) export HTML에 임베드되어 이식된다. render()는 sync라 여기서 비동기로 미리 캐싱.
   */
  private async resolveTier3Overrides(): Promise<void> {
    const out: Record<string, string> = {};
    const overrides = this.settings.tier3BgOverrides ?? {};
    for (const [themeId, raw] of Object.entries(overrides)) {
      const ref = (raw ?? "").trim();
      if (!ref) continue;
      if (/^(https?:|data:|app:)/i.test(ref)) continue; // URL은 렌더러가 직접 처리
      const dataUri = await this.readLocalImageAsDataUri(ref);
      if (dataUri) out[themeId] = dataUri;
    }
    this.renderer.setTier3ResolvedOverrides(out);
  }

  /**
   * 파일명/상대경로/절대경로를 받아 vault adapter로 읽어 base64 data URI로 변환.
   * 후보 경로(순서대로 시도): ① 절대경로면 vault 루트를 떼어 vault-relative化,
   * ② 입력 그대로(vault-relative), ③ 플러그인 폴더 기준(파일명만 넣은 경우).
   * 어느 것도 없으면 null → 호출부가 번들 기본으로 폴백.
   */
  private async readLocalImageAsDataUri(ref: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    const norm = ref.replace(/\\/g, "/").trim();
    const candidates: string[] = [];
    let base = "";
    if (adapter instanceof FileSystemAdapter) {
      try {
        base = adapter.getBasePath().replace(/\\/g, "/").replace(/\/+$/, "");
      } catch {
        base = "";
      }
    }
    if (base && norm.toLowerCase().startsWith(base.toLowerCase() + "/")) {
      candidates.push(norm.slice(base.length + 1));
    }
    candidates.push(norm);
    if (this.manifest.dir) candidates.push(`${this.manifest.dir}/${norm}`);

    for (const p of candidates) {
      try {
        if (await adapter.exists(p)) {
          const buf = await adapter.readBinary(p);
          return `data:${this.mimeFromExt(p)};base64,${this.arrayBufferToBase64(buf)}`;
        }
      } catch {
        // 다음 후보 시도
      }
    }
    return null;
  }

  private mimeFromExt(p: string): string {
    const e = p.toLowerCase();
    if (e.endsWith(".png")) return "image/png";
    if (e.endsWith(".jpg") || e.endsWith(".jpeg")) return "image/jpeg";
    if (e.endsWith(".gif")) return "image/gif";
    if (e.endsWith(".svg")) return "image/svg+xml";
    return "image/webp";
  }

  private arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + chunk, bytes.length))
      );
    }
    return btoa(binary);
  }

  private async activateSlideView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(SLIDE_VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({
          type: SLIDE_VIEW_TYPE,
          active: true,
        });
      }
    }

    if (leaf) {
      await workspace.revealLeaf(leaf);
    }
  }

  private async exportCurrentFileAsHTML(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      return;
    }

    const markdown = await this.app.vault.read(activeFile);
    // v5.5 Phase 6 — closed-loop via offscreen iframe so exported HTML is
    // overflow-free (same guarantee as the live preview).
    const { deck } = await auditedRenderOffscreen(
      (budgetShrink) =>
        this.renderer.render(markdown, this.app.vault, {
          budgetShrink,
          title: activeFile.basename,
        }),
      {
        maxPasses: AUDIT_MAX_PASSES,
        tolerancePx: AUDIT_TOLERANCE_PX,
        shrinkMargin: AUDIT_SHRINK_MARGIN,
      }
    );
    const exportPath = activeFile.path.replace(/\.md$/, ".slides.html");

    const html = await this.embedRemoteAssets(deck.html);
    await this.app.vault.adapter.write(exportPath, html);
  }

  /**
   * v7.0 — export 자동 임베드. v8.0 — 본문 `<img>`까지 확장. 렌더된 덱 HTML의 원격(https)
   * 이미지 참조를 fetch해 base64 data URI로 치환한다:
   *   ① CSS 배경  `url('https://…')`  ② 본문/이모지  `<img … src="https://…">`
   * 결과 덱은 완전 자체완결(R2 배경·본문 이미지·twemoji 등 외부 의존 0) → 공유받아 보는 사람은
   * 외부 서버를 거치지 않는다(트래픽 0, 오프라인 OK). 같은 URL은 1회만 받는다(중복 제거). fetch
   * 실패 시 원래 URL을 그대로 둬 최소한 온라인에선 보이게 한다. 하이퍼링크(`<a href>`)는 클릭
   * 대상이라 건드리지 않는다. preview는 영향 없음(원격 URL 그대로).
   */
  async embedRemoteAssets(html: string): Promise<string> {
    // CSS 배경(따옴표 종류 무관)과 본문 <img src>를 모두 수집한다. <img>는 src 앞에 다른
    // 속성(class/alt/draggable…)이 올 수 있어 비탐욕 [^>]*?\bsrc= 로 첫 src까지만 매칭.
    const cssUrlRe = /url\((['"]?)(https?:\/\/[^'")]+)\1\)/g;
    const imgSrcRe = /(<img\b[^>]*?\bsrc=)(["'])(https?:\/\/[^"']+)\2/g;

    const urls = new Set<string>();
    for (const m of html.matchAll(cssUrlRe)) urls.add(m[2]);
    for (const m of html.matchAll(imgSrcRe)) urls.add(m[3]);
    if (urls.size === 0) return html;

    const map: Record<string, string> = {};
    for (const u of urls) {
      try {
        const res = await requestUrl({ url: u });
        const ct =
          (res.headers &&
            (res.headers["content-type"] || res.headers["Content-Type"])) ||
          this.mimeFromExt(u);
        const mime = String(ct).split(";")[0].trim() || "image/png";
        map[u] = `data:${mime};base64,${this.arrayBufferToBase64(
          res.arrayBuffer
        )}`;
      } catch (e) {
        console.warn("Achmage: 이미지 임베드 실패(원격 URL 유지):", u, e);
      }
    }
    let out = html.replace(cssUrlRe, (m, q, u) =>
      map[u] ? `url(${q}${map[u]}${q})` : m
    );
    out = out.replace(imgSrcRe, (m, pre, q, u) =>
      map[u] ? `${pre}${q}${map[u]}${q}` : m
    );
    return out;
  }
}

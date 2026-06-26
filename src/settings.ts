import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type AchmageSlides from "./main";
import { TIER3_BG_PROMPTS } from "./themes/tier3BgPrompts";

/** v7.0 — Tier 3 배경 설정의 테마별 행에 쓰는 (id, 표시명) 목록. Default theme
 *  드롭다운과 동일 순서. native 1920 v5 테마만 배경 wash 대상이다. */
const TIER3_THEME_ROWS: { id: string; name: string }[] = [
  { id: "cmds-dark-native-1920-v5", name: "CMDS-Dark 1920 v5" },
  { id: "obsidian-cyan", name: "Obsidian Cyan" },
  { id: "cobalt-sand", name: "Cobalt Sand" },
  { id: "deep-navy-ice", name: "Deep Navy Ice" },
  { id: "graphite-topaz", name: "Graphite Topaz" },
  { id: "arctic-violet", name: "Arctic Violet" },
  { id: "hallym-light", name: "Hallym Light" },
];

// ---------------------------------------------------------------------------
// Typographic Scale System
// ---------------------------------------------------------------------------

export type TypographicScaleName =
  | "minorSecond"
  | "majorSecond"
  | "minorThird"
  | "majorThird"
  | "perfectFourth"
  | "augmentedFourth"
  | "perfectFifth"
  | "goldenRatio";

export const TYPOGRAPHIC_SCALES: Record<
  TypographicScaleName,
  { label: string; ratio: number }
> = {
  minorSecond:     { label: "Minor Second (1.067)",      ratio: 1.067 },
  majorSecond:     { label: "Major Second (1.125)",      ratio: 1.125 },
  minorThird:      { label: "Minor Third (1.200)",       ratio: 1.200 },
  majorThird:      { label: "Major Third (1.250)",       ratio: 1.250 },
  perfectFourth:   { label: "Perfect Fourth (1.333)",    ratio: 1.333 },
  augmentedFourth: { label: "Augmented Fourth (1.414)",  ratio: 1.414 },
  perfectFifth:    { label: "Perfect Fifth (1.500)",     ratio: 1.500 },
  goldenRatio:     { label: "Golden Ratio (1.618)",      ratio: 1.618 },
};

// ---------------------------------------------------------------------------
// Settings Interface
// ---------------------------------------------------------------------------

export interface AchmageSettings {
  /** Settings schema version for migrations */
  settingsVersion: number;
  /** Theme to use when frontmatter doesn't specify one */
  defaultTheme: string;
  /** Base font size in px */
  baseFontSize: number;
  /** Typographic scale ratio */
  typographicScale: TypographicScaleName;
  /** Heading levels that auto-split into slides */
  headingDivider: number[];
  /** Auto-inject paginate: true */
  autoPaginate: boolean;
  /** Default slide transition effect */
  defaultTransition: string;
  /** Math rendering engine */
  mathEngine: "mathjax" | "katex";
  /** Enable auto continued-frame splitting */
  autoContinuedFrames: boolean;
  /**
   * v6.0 (Tier 2) — plain markdown의 구조 시그니처를 보고 결정론적으로 정교한
   * 레이아웃 템플릿(section divider 등)을 적용한다. 기본 off: 켜지 않으면 출력이
   * v5.x 경로와 byte-identical. 매치되지 않는 슬라이드는 항상 raw-flow로 통과.
   */
  tier2Layouts: boolean;
  /**
   * v7.0 (과제 A) — 텍스트가 적은(sparse) 순수 문단 슬라이드의 본문을 측정 기반으로
   * 배수 확대 + 중앙정렬 + 행간 확대한다. 기본 off: 켜지 않으면 출력 byte-identical.
   * dense/혼합/heading 포함 프레임은 불변, 확대 후 재측정으로 overflow 0 보장.
   */
  tier3BodyPolishing: boolean;
  /**
   * v7.0 (과제 B) — 모든 슬라이드 배경에 테마별 기본 이미지(번들) 또는 사용자 교체
   * 이미지를 풀블리드로 깔고 그 위에 반투명 wash 막을 얹는다. 기본 off:
   * 클래스/레이어 미주입 = 슬라이드 HTML byte-identical. 배경은 absolute 레이어라
   * Tier 2 측정/라우팅과 무관.
   */
  tier3Backgrounds: boolean;
  /** wash 막 모드. "auto" = 테마 밝기(paletteMode)에서 light/dark 유도 */
  tier3WashMode: "auto" | "light" | "dark";
  /** wash 막 불투명도 0~1 (사진을 죽이는 정도) */
  tier3WashOpacity: number;
  /**
   * themeId → 교체용 배경(https URL 또는 vault 상대경로). 비어 있으면 번들 기본 사용.
   * https/data URI는 preview·export 모두 이식, vault 경로는 preview 한정.
   */
  tier3BgOverrides: Record<string, string>;
}

export { DEFAULT_SETTINGS } from "./settingsDefaults";

// ---------------------------------------------------------------------------
// Settings Tab UI
// ---------------------------------------------------------------------------

export class AchmageSettingTab extends PluginSettingTab {
  plugin: AchmageSlides;

  constructor(app: App, plugin: AchmageSlides) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("achmage-settings-tab");

    new Setting(containerEl)
      .setName("Achmage Slides Ultra 1920 v5")
      .setHeading();

    // ── Appearance ──────────────────────────────────────────────────────
    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Default theme")
      .setDesc("Theme used when the document has no theme in frontmatter")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("cmds-dark-native-1920-v5", "CMDS-Dark 1920 v5")
          .addOption("obsidian-cyan", "Obsidian Cyan")
          .addOption("cobalt-sand", "Cobalt Sand")
          .addOption("deep-navy-ice", "Deep Navy Ice")
          .addOption("graphite-topaz", "Graphite Topaz")
          .addOption("arctic-violet", "Arctic Violet")
          .addOption("hallym-light", "Hallym Light")
          .setValue(this.plugin.settings.defaultTheme)
          .onChange(async (value) => {
            this.plugin.settings.defaultTheme = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Typography ──────────────────────────────────────────────────────
    new Setting(containerEl).setName("Typography").setHeading();

    // Live preview element for computed sizes
    const typoPreviewEl = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    const updateTypoPreview = () => {
      const s = this.plugin.settings;
      const ratio = TYPOGRAPHIC_SCALES[s.typographicScale].ratio;
      const h3 = Math.round(s.baseFontSize * ratio);
      const h2 = Math.round(s.baseFontSize * Math.pow(ratio, 2));
      const h1 = Math.round(s.baseFontSize * Math.pow(ratio, 3));
      typoPreviewEl.textContent =
        `Base: ${s.baseFontSize}px | H3: ${h3}px (${ratio.toFixed(3)}em) | ` +
        `H2: ${h2}px (${Math.pow(ratio, 2).toFixed(3)}em) | ` +
        `H1: ${h1}px (${Math.pow(ratio, 3).toFixed(3)}em)`;
    };
    updateTypoPreview();

    new Setting(containerEl)
      .setName("Base font size")
      .setDesc("Body text size in pixels (16–40)")
      .addSlider((slider) => {
        // UX patch — Obsidian's built-in slider track is nearly invisible in
        // some themes. Show the current value as an *editable* number input
        // next to the slider so the user can either drag the slider or click
        // the field to type a value (16-40, clamped on commit).
        const baseInputEl = document.createElement("input");
        baseInputEl.type = "number";
        baseInputEl.min = "16";
        baseInputEl.max = "40";
        baseInputEl.step = "1";
        baseInputEl.className = "achmage-base-value";
        baseInputEl.value = String(this.plugin.settings.baseFontSize);
        baseInputEl.title = "Click to type a value (16–40)";

        const commitInput = async () => {
          const raw = parseInt(baseInputEl.value, 10);
          const fallback = this.plugin.settings.baseFontSize;
          const clamped = Math.max(
            16,
            Math.min(40, Number.isFinite(raw) ? raw : fallback)
          );
          baseInputEl.value = String(clamped);
          if (this.plugin.settings.baseFontSize !== clamped) {
            this.plugin.settings.baseFontSize = clamped;
            slider.setValue(clamped);
            updateTypoPreview();
            await this.plugin.saveSettings();
          }
        };

        baseInputEl.addEventListener("change", commitInput);
        baseInputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            baseInputEl.blur();
          }
        });

        slider
          .setLimits(16, 40, 1)
          .setValue(this.plugin.settings.baseFontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.baseFontSize = value;
            baseInputEl.value = String(value);
            updateTypoPreview();
            await this.plugin.saveSettings();
          });

        slider.sliderEl.parentElement?.appendChild(baseInputEl);
      });

    new Setting(containerEl)
      .setName("Typographic scale")
      .setDesc("Ratio between successive heading levels (see typescale.com)")
      .addDropdown((dropdown) => {
        for (const [key, { label }] of Object.entries(TYPOGRAPHIC_SCALES)) {
          dropdown.addOption(key, label);
        }
        return dropdown
          .setValue(this.plugin.settings.typographicScale)
          .onChange(async (value: string) => {
            this.plugin.settings.typographicScale =
              value as TypographicScaleName;
            updateTypoPreview();
            await this.plugin.saveSettings();
          });
      });

    // ── Slide Structure ──────────────────────────────────────────────────
    new Setting(containerEl).setName("Slide Structure").setHeading();

    new Setting(containerEl)
      .setName("Heading divider levels")
      .setDesc(
        "Which heading levels auto-split into new slides (e.g. '1,2' means # and ## create new slides)"
      )
      .addText((text) =>
        text
          .setPlaceholder("1,2")
          .setValue(this.plugin.settings.headingDivider.join(","))
          .onChange(async (value) => {
            const levels = value
              .split(",")
              .map((s) => parseInt(s.trim(), 10))
              .filter((n) => n >= 1 && n <= 6) as (1 | 2 | 3 | 4 | 5 | 6)[];
            if (levels.length > 0) {
              this.plugin.settings.headingDivider = levels;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Auto paginate")
      .setDesc("Automatically add page numbers to slides")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoPaginate)
          .onChange(async (value) => {
            this.plugin.settings.autoPaginate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default transition")
      .setDesc("Slide transition effect when not specified in frontmatter")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "None")
          .addOption("fade", "Fade")
          .addOption("slide", "Slide")
          .addOption("reveal", "Reveal")
          .addOption("zoom", "Zoom")
          .addOption("wipe", "Wipe")
          .setValue(this.plugin.settings.defaultTransition)
          .onChange(async (value) => {
            this.plugin.settings.defaultTransition = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Render ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Render").setHeading();

    new Setting(containerEl)
      .setName("Math engine")
      .setDesc("Choose between MathJax (comprehensive) or KaTeX (fast)")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("mathjax", "MathJax")
          .addOption("katex", "KaTeX")
          .setValue(this.plugin.settings.mathEngine)
          .onChange(async (value: string) => {
            this.plugin.settings.mathEngine = value as "mathjax" | "katex";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto continued frames")
      .setDesc(
        "Automatically split slides that are too long into continued frames"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoContinuedFrames)
          .onChange(async (value) => {
            this.plugin.settings.autoContinuedFrames = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tier 2 layouts (experimental)")
      .setDesc(
        "Deterministically apply refined layouts (e.g. section dividers) from plain markdown structure. Off = output identical to v5."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.tier2Layouts)
          .onChange(async (value) => {
            this.plugin.settings.tier2Layouts = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Tier 3: Body polish & backgrounds (v7.0) ─────────────────────────
    new Setting(containerEl).setName("Tier 3 (experimental)").setHeading();

    new Setting(containerEl)
      .setName("Body-text polishing")
      .setDesc(
        "On text-sparse paragraph slides, enlarge + center the body and open up line-height. Off = output identical to current. Only fires where it stays within the overflow budget."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.tier3BodyPolishing)
          .onChange(async (value) => {
            this.plugin.settings.tier3BodyPolishing = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Photo backgrounds + wash")
      .setDesc(
        "Full-bleed photo background on every slide with a translucent wash on top. Uses the bundled per-theme image (or your override below). Off = no change."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.tier3Backgrounds)
          .onChange(async (value) => {
            this.plugin.settings.tier3Backgrounds = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Wash mode")
      .setDesc(
        "Auto = paper wash on light themes, dark scrim on dark themes. Override to force one."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto (match theme)")
          .addOption("light", "Light (paper, dark text)")
          .addOption("dark", "Dark (scrim, white text)")
          .setValue(this.plugin.settings.tier3WashMode)
          .onChange(async (value: string) => {
            this.plugin.settings.tier3WashMode =
              value as "auto" | "light" | "dark";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Wash opacity")
      .setDesc("How strongly the wash mutes the photo (0–1).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.tier3WashOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tier3WashOpacity = value;
            await this.plugin.saveSettings();
          })
      );

    // ── 배경 이미지 (테마별) ──────────────────────────────────────────────
    new Setting(containerEl).setName("배경 이미지 (테마별)").setHeading();

    const guide = containerEl.createEl("div", {
      cls: "setting-item-description",
    });
    guide.createEl("p", {
      text: "각 테마엔 기본 배경이 내장돼 있어, 위 「Photo backgrounds + wash」 토글만 켜면 바로 나옵니다. 배경을 바꾸려면 아래 각 테마의 입력칸에 다음 중 하나를 넣으세요:",
    });
    const ul = guide.createEl("ul");
    ul.createEl("li", {
      text: "① 이미지 파일을 플러그인 폴더(아래 「폴더 열기」)에 넣고, 파일명만 입력 — 예: my-bg.webp",
    });
    ul.createEl("li", {
      text: "② 또는 인터넷 이미지 주소(https://…)를 붙여넣기",
    });
    ul.createEl("li", {
      text: "③ 「Copy prompt」로 AI 맞춤 배경을 만든 뒤 ①·②로 교체",
    });
    guide.createEl("p", {
      text: "기본값으로 고급 배경(R2 호스팅) 주소가 미리 채워져 있습니다. 입력칸을 비우면 플러그인에 내장된 작은 기본 배경으로 폴백합니다. export 시에는 원격(https)·로컬 이미지가 HTML에 자동 임베드되어, 덱을 공유받아 보는 사람은 외부 서버를 거치지 않고(자체완결) 인터넷 없이도 배경이 보입니다.",
    });

    // 플러그인 폴더 경로 + 열기 버튼 (로컬 이미지를 여기에 떨어뜨리면 됨)
    // FileSystemAdapter를 import하지 않고 duck-typing — 테스트 번들 스텁 의존 회피.
    const adapter = this.plugin.app.vault.adapter as unknown as {
      getBasePath?: () => string;
    };
    const dir = this.plugin.manifest.dir ?? "";
    let pluginAbs = dir;
    if (typeof adapter.getBasePath === "function" && dir) {
      pluginAbs = `${adapter.getBasePath()}/${dir}`.replace(/\//g, "\\");
    }
    new Setting(containerEl)
      .setName("플러그인 폴더")
      .setDesc(pluginAbs || "(경로를 확인할 수 없습니다)")
      .addButton((btn) =>
        btn
          .setButtonText("폴더 열기")
          .setTooltip("로컬 배경 이미지를 이 폴더에 넣으세요")
          .onClick(async () => {
            // electron을 직접 require하지 않는다(커뮤니티 리뷰 정책). Obsidian이 vault 내부
            // (.obsidian/plugins/…) 폴더를 OS 기본 앱(파일 탐색기)으로 열어 준다 —
            // openWithDefaultApp은 vault-relative 경로를 받는다. 메서드가 없거나(구버전·모바일)
            // 실패하면 절대경로를 클립보드에 복사해 사용자가 직접 열도록 폴백한다.
            const app = this.plugin.app as App & {
              openWithDefaultApp?: (path: string) => void;
            };
            if (dir && typeof app.openWithDefaultApp === "function") {
              try {
                app.openWithDefaultApp(dir);
                return;
              } catch {
                // 폴백으로 진행
              }
            }
            try {
              await navigator.clipboard.writeText(pluginAbs);
              new Notice(`폴더 경로를 클립보드에 복사했습니다:\n${pluginAbs}`);
            } catch {
              new Notice(`폴더를 직접 여세요: ${pluginAbs}`);
            }
          })
      );

    for (const { id, name } of TIER3_THEME_ROWS) {
      new Setting(containerEl)
        .setName(name)
        .setDesc("비우면 내장 기본 배경. 바꾸려면 파일명 또는 https 주소")
        .addButton((btn) =>
          btn
            .setButtonText("Copy prompt")
            .setTooltip(`${name} 배경 생성 프롬프트 복사 (노트 첨부 후 AI에 붙여넣기)`)
            .onClick(async () => {
              const prompt = TIER3_BG_PROMPTS[id] ?? "";
              await navigator.clipboard.writeText(prompt);
              new Notice(`${name} 배경 프롬프트를 복사했습니다`);
            })
        )
        .addText((text) =>
          text
            .setPlaceholder("my-bg.webp  또는  https://…")
            .setValue(this.plugin.settings.tier3BgOverrides[id] ?? "")
            .onChange(async (value) => {
              const v = value.trim();
              if (v) {
                this.plugin.settings.tier3BgOverrides[id] = v;
              } else {
                delete this.plugin.settings.tier3BgOverrides[id];
              }
              await this.plugin.saveSettings();
            })
        );
    }
  }
}

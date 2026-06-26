import Marp from "@marp-team/marp-core";
import type { MarpOptions } from "@marp-team/marp-core";
import type { AchmageSettings } from "../settings";
import {
  CMDS_DARK_THEME,
  OBSIDIAN_CYAN_THEME,
  DEEP_NAVY_ICE_THEME,
  COBALT_SAND_THEME,
  GRAPHITE_TOPAZ_THEME,
  ARCTIC_VIOLET_THEME,
  HALLYM_LIGHT_THEME,
} from "../themes/themeRegistry";

export interface SlideRenderResult {
  /** Array of HTML strings, one per slide */
  slides: string[];
  /** Combined CSS for all slides */
  css: string;
  /** Comments extracted from each slide */
  comments: string[][];
}

export class MarpEngine {
  private marp: Marp;

  constructor(settings: AchmageSettings) {
    const opts: MarpOptions = {
      html: true,
      math: settings.mathEngine === "katex" ? "katex" : "mathjax",
      emoji: { unicode: "twemoji" },
      script: false,
      minifyCSS: false,
    };

    this.marp = new Marp(opts);
    this.registerThemes();
  }

  private registerThemes(): void {
    this.marp.themeSet.add(CMDS_DARK_THEME);
    this.marp.themeSet.add(OBSIDIAN_CYAN_THEME);
    this.marp.themeSet.add(DEEP_NAVY_ICE_THEME);
    this.marp.themeSet.add(COBALT_SAND_THEME);
    this.marp.themeSet.add(GRAPHITE_TOPAZ_THEME);
    this.marp.themeSet.add(ARCTIC_VIOLET_THEME);
    this.marp.themeSet.add(HALLYM_LIGHT_THEME);
  }

  render(markdown: string): SlideRenderResult {
    const result = this.marp.render(markdown, { htmlAsArray: true });
    return {
      slides: result.html,
      css: result.css,
      comments: result.comments,
    };
  }

  /** Re-create the engine with new settings */
  rebuild(settings: AchmageSettings): void {
    const opts: MarpOptions = {
      html: true,
      math: settings.mathEngine === "katex" ? "katex" : "mathjax",
      emoji: { unicode: "twemoji" },
      script: false,
      minifyCSS: false,
    };
    this.marp = new Marp(opts);
    this.registerThemes();
  }
}

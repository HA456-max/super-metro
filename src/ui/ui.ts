/**
 * DOM UI overlay for the Canvas game.
 *
 * The UI is intentionally rendered with HTML/CSS rather than Canvas. It binds
 * to GameState-like values and delegates simulation actions to callbacks, so it
 * does not own game logic or mutate the simulation directly.
 */

import type { GameState } from "../core/gameLoop";
import type { ResourceStock, UpgradeOption } from "../systems/resourceSystem";

export interface UiController {
  pause(): void;
  resume(): void;
  applyUpgrade(option: UpgradeOption): boolean;
  restart(): void;
  setSpeed?(multiplier: number): void;
}

export interface UiOptions {
  /** Parent element for the overlay. Defaults to document.body. */
  mount?: HTMLElement;
  /** Called when the user toggles the speed button. */
  onSpeedChange?: (multiplier: number) => void;
  /** Optional custom restart behavior. */
  onRestart?: () => void;
}

const STYLE_ID = "supermetro-ui-styles";

/** HTML/CSS overlay for resources, simulation controls, upgrades, and game over. */
export class GameUI {
  private readonly controller: UiController;
  private readonly root: HTMLDivElement;
  private readonly resourceBar: HTMLDivElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly upgradeOverlay: HTMLDivElement;
  private readonly upgradeCards: HTMLDivElement;
  private readonly gameOverOverlay: HTMLDivElement;
  private readonly survivedWeeks: HTMLSpanElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly onSpeedChange?: UiOptions["onSpeedChange"];
  private readonly onRestart?: UiOptions["onRestart"];
  private speedMultiplier = 1;
  private latestState?: GameState;

  constructor(controller: UiController, options: UiOptions = {}) {
    if (typeof document === "undefined") {
      throw new Error("GameUI requires a browser DOM.");
    }

    this.controller = controller;
    this.onSpeedChange = options.onSpeedChange;
    this.onRestart = options.onRestart;
    const mount = options.mount ?? document.body;

    ensureStyles();
    this.root = createElement("div", "supermetro-ui");
    this.resourceBar = createElement("div", "supermetro-resource-bar");
    this.pauseButton = createButton("暂停", "supermetro-control-button");
    this.speedButton = createButton("速度 ×1", "supermetro-control-button");
    this.upgradeOverlay = createElement("div", "supermetro-modal-overlay");
    this.upgradeCards = createElement("div", "supermetro-upgrade-cards");
    this.gameOverOverlay = createElement("div", "supermetro-modal-overlay");
    this.survivedWeeks = createElement("span", "supermetro-survived-weeks");
    this.restartButton = createButton("重新开始", "supermetro-primary-button");

    this.buildResourceBar();
    this.buildUpgradeModal();
    this.buildGameOverModal();
    mount.appendChild(this.root);
    this.bindEvents();
  }

  /** Updates all visible UI from the current simulation state. */
  update(state: GameState): void {
    this.latestState = state;
    this.renderResources(state.resources);

    const paused = state.mode === "paused";
    this.pauseButton.textContent = paused ? "继续" : "暂停";
    this.pauseButton.disabled = state.mode === "upgrade" || state.mode === "gameover";

    this.upgradeOverlay.classList.toggle("is-visible", state.mode === "upgrade");
    this.renderUpgradeOptions(state.upgradeOptions, state.mode === "upgrade");

    this.gameOverOverlay.classList.toggle("is-visible", state.mode === "gameover");
    this.survivedWeeks.textContent = String(Math.max(0, state.week - 1));
  }

  /** Removes the overlay and its event handlers from the DOM. */
  destroy(): void {
    this.root.remove();
  }

  private buildResourceBar(): void {
    const resources = [
      ["lines", "线路", "#e76f51"],
      ["trains", "列车", "#4d96ff"],
      ["tunnels", "隧道", "#8e7dbe"],
    ] as const;

    for (const [key, label, color] of resources) {
      const item = createElement("div", "supermetro-resource-item");
      item.dataset.resource = key;
      item.innerHTML = `<span class="supermetro-resource-dot" style="background:${color}"></span><span>${label}</span><strong>0</strong>`;
      this.resourceBar.appendChild(item);
    }

    const controls = createElement("div", "supermetro-controls");
    controls.append(this.pauseButton, this.speedButton);
    this.root.append(this.resourceBar, controls);
  }

  private buildUpgradeModal(): void {
    const panel = createElement("section", "supermetro-modal");
    panel.innerHTML = `<p class="supermetro-kicker">WEEKLY UPGRADE</p><h2>选择一项升级</h2><p class="supermetro-muted">升级将在下一周生效</p>`;
    panel.appendChild(this.upgradeCards);
    this.upgradeOverlay.appendChild(panel);
    this.root.appendChild(this.upgradeOverlay);
  }

  private buildGameOverModal(): void {
    const panel = createElement("section", "supermetro-modal");
    panel.innerHTML = `<p class="supermetro-kicker">NETWORK CLOSED</p><h2>游戏结束</h2><p class="supermetro-muted">你存活了 <strong class="supermetro-survived-weeks">0</strong> 周</p>`;
    const survived = panel.querySelector(".supermetro-survived-weeks");
    if (!survived) throw new Error("Failed to create survived-weeks element.");
    this.survivedWeeks = survived as HTMLSpanElement;
    panel.appendChild(this.restartButton);
    this.gameOverOverlay.appendChild(panel);
    this.root.appendChild(this.gameOverOverlay);
  }

  private bindEvents(): void {
    this.pauseButton.addEventListener("click", () => {
      if (!this.latestState) return;
      if (this.latestState.mode === "paused") this.controller.resume();
      else this.controller.pause();
    });

    this.speedButton.addEventListener("click", () => {
      this.speedMultiplier = this.speedMultiplier === 1 ? 2 : 1;
      this.speedButton.textContent = `速度 ×${this.speedMultiplier}`;
      this.controller.setSpeed?.(this.speedMultiplier);
      this.onSpeedChange?.(this.speedMultiplier);
    });

    this.restartButton.addEventListener("click", () => {
      this.onRestart?.();
      this.controller.restart();
    });
  }

  private renderResources(resources: ResourceStock): void {
    for (const key of ["lines", "trains", "tunnels"] as const) {
      const item = this.resourceBar.querySelector(`[data-resource="${key}"]`);
      const value = item?.querySelector("strong");
      if (value) value.textContent = String(resources[key]);
    }
  }

  private renderUpgradeOptions(options: readonly UpgradeOption[], visible: boolean): void {
    if (!visible) return;
    this.upgradeCards.replaceChildren();
    for (const option of options.slice(0, 3)) {
      const button = createButton(option.label, "supermetro-upgrade-card");
      button.type = "button";
      button.addEventListener("click", () => {
        if (this.controller.applyUpgrade(option)) {
          this.upgradeOverlay.classList.remove("is-visible");
        }
      });
      this.upgradeCards.appendChild(button);
    }
  }
}

/** Alias matching the requested UI module naming. */
export { GameUI as UI };

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function createButton(text: string, className: string): HTMLButtonElement {
  const button = createElement("button", className);
  button.type = "button";
  button.textContent = text;
  return button;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.supermetro-ui{position:fixed;inset:0;z-index:10;pointer-events:none;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#304047}.supermetro-resource-bar,.supermetro-controls{pointer-events:auto;position:absolute;top:16px;display:flex;align-items:center;gap:10px;background:rgba(255,253,248,.9);border:1px solid rgba(82,99,107,.14);border-radius:16px;padding:9px 12px;box-shadow:0 5px 20px rgba(50,60,60,.1);backdrop-filter:blur(8px)}.supermetro-resource-bar{left:16px}.supermetro-controls{right:16px}.supermetro-resource-item{display:flex;align-items:center;gap:6px;padding:0 7px}.supermetro-resource-item strong{min-width:1.2em;text-align:center}.supermetro-resource-dot{width:8px;height:8px;border-radius:50%;display:inline-block}.supermetro-control-button,.supermetro-primary-button,.supermetro-upgrade-card{border:0;border-radius:10px;background:#eef2ef;color:#304047;cursor:pointer;padding:8px 12px;font:inherit;transition:transform .15s,background .15s}.supermetro-control-button:hover,.supermetro-primary-button:hover,.supermetro-upgrade-card:hover{background:#dcebe5;transform:translateY(-1px)}button:disabled{opacity:.5;cursor:not-allowed}.supermetro-modal-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(38,50,56,.22);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s}.supermetro-modal-overlay.is-visible{opacity:1;visibility:visible;pointer-events:auto}.supermetro-modal{min-width:300px;max-width:90vw;padding:28px;border-radius:20px;background:#fffdf8;box-shadow:0 14px 50px rgba(38,50,56,.2);text-align:center}.supermetro-modal h2{margin:4px 0 2px;font-size:24px}.supermetro-kicker{margin:0;color:#e76f51;font-size:11px;font-weight:700;letter-spacing:.16em}.supermetro-muted{color:#718087}.supermetro-upgrade-cards{display:flex;gap:10px;margin-top:20px}.supermetro-upgrade-card{min-width:110px;min-height:70px;background:#f1f6f2;font-weight:600}.supermetro-primary-button{margin-top:18px;background:#e76f51;color:white}@media(max-width:520px){.supermetro-resource-bar{left:8px;right:8px;justify-content:center}.supermetro-controls{top:66px;right:8px}.supermetro-upgrade-cards{flex-direction:column}.supermetro-upgrade-card{width:100%}}
`;
  document.head.appendChild(style);
}

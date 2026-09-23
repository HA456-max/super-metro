/**
 * Manages the player's finite metro resources and weekly upgrade choices.
 *
 * This system has no rendering or UI dependency. A UI can call
 * `getUpgradeOptions()` at the end of a week, display the returned options,
 * and pass the selected option to `applyUpgrade()`.
 */

export type ResourceType = "lines" | "trains" | "tunnels" | "carriages";

export interface ResourceStock {
  lines: number;
  trains: number;
  tunnels: number;
  carriages: number;
}

export interface UpgradeOption {
  id: string;
  resourceType: ResourceType;
  amount: 1;
  label: string;
}

export interface ResourceSystemOptions {
  random?: () => number;
  initialResources?: Partial<ResourceStock>;
}

const RESOURCE_TYPES: readonly ResourceType[] = [
  "lines",
  "trains",
  "tunnels",
  "carriages",
];

const UPGRADE_LABELS: Record<ResourceType, string> = {
  lines: "+1 线路",
  trains: "+1 列车",
  tunnels: "+1 隧道",
  carriages: "+1 车厢",
};

const DEFAULT_RESOURCES: ResourceStock = {
  lines: 3,
  trains: 3,
  tunnels: 0,
  carriages: 0,
};

export class ResourceSystem {
  private readonly resources: ResourceStock;
  private readonly random: () => number;
  private optionSequence = 0;

  constructor(options: ResourceSystemOptions = {}) {
    this.resources = {
      ...DEFAULT_RESOURCES,
      ...options.initialResources,
    };
    this.random = options.random ?? Math.random;

    for (const resourceType of RESOURCE_TYPES) {
      this.resources[resourceType] = Math.max(
        0,
        Math.floor(this.resources[resourceType]),
      );
    }
  }

  /** Returns whether at least one unit of a resource is available. */
  canUse(resourceType: ResourceType): boolean {
    return this.resources[resourceType] > 0;
  }

  /**
   * Consumes one unit of a resource.
   * Returns false and leaves the stock unchanged when unavailable.
   */
  consume(resourceType: ResourceType): boolean {
    if (!this.canUse(resourceType)) return false;
    this.resources[resourceType] -= 1;
    return true;
  }

  /** Returns a copy so callers cannot mutate the internal resource stock. */
  getResources(): ResourceStock {
    return { ...this.resources };
  }

  /**
   * Creates three distinct random upgrade choices for the end-of-week UI.
   * Calling this method starts/replaces the current choice set.
   */
  getUpgradeOptions(): UpgradeOption[] {
    const shuffled = [...RESOURCE_TYPES];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = randomIndex(this.random, index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled.slice(0, 3).map((resourceType) => ({
      id: `upgrade-${++this.optionSequence}-${resourceType}`,
      resourceType,
      amount: 1,
      label: UPGRADE_LABELS[resourceType],
    }));
  }

  /** Applies the selected weekly upgrade. Returns false for invalid options. */
  applyUpgrade(option: UpgradeOption): boolean {
    if (!RESOURCE_TYPES.includes(option.resourceType)) return false;
    if (option.amount !== 1) return false;

    this.resources[option.resourceType] += option.amount;
    return true;
  }
}

function randomIndex(random: () => number, length: number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

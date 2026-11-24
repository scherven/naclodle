/**
 * Seeded randomness. The generator is pure-rand's xoroshiro128+, seeded with the first 32 bits of the
 * SHA-256 of the seed string. This wrapper is the only file that knows the library's API.
 */

import { createHash } from "node:crypto";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { uniformFloat64 } from "pure-rand/distribution/uniformFloat64";
import { uniformInt } from "pure-rand/distribution/uniformInt";

type Generator = ReturnType<typeof xoroshiro128plus>;

export function seedFromString(seedText: string): number {
  return createHash("sha256").update(seedText).digest().readInt32LE(0);
}

export class Rng {
  private readonly generator: Generator;

  constructor(seedText: string) {
    this.generator = xoroshiro128plus(seedFromString(seedText));
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return uniformFloat64(this.generator);
  }

  /** Uniform integer in [low, high]. */
  int(low: number, high: number): number {
    return uniformInt(this.generator, low, high);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  /** Pick by weight from [value, weight] pairs. */
  weighted<T>(weightedItems: readonly (readonly [T, number])[]): T {
    const total = weightedItems.reduce((sum, [, weight]) => sum + weight, 0);
    let remaining = this.next() * total;
    for (const [value, weight] of weightedItems) {
      remaining -= weight;
      if (remaining < 0) return value;
    }
    return weightedItems[weightedItems.length - 1][0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const shuffled = items.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /** Power-law ("dropoff") pick: earlier items are more frequent, as in zompist's gen. */
  dropoff<T>(items: readonly T[], exponent = 0.8): T {
    return this.weighted(items.map((item, rank) => [item, 1 / Math.pow(rank + 1, exponent)] as const));
  }
}

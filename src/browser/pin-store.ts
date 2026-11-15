import type { ComparisonDiff, PickedElementInfo } from '../types.js';
import { TOKEN_BUDGETS } from '../constants.js';
import { computeComparisonDiff } from '../analyzers/design-blueprint.js';

export class PinStore {
  private queue: PickedElementInfo[] = [];
  private sequence = 0;

  public nextId(): string {
    return `pin-${++this.sequence}`;
  }

  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  public add(pin: PickedElementInfo): void {
    pin = structuredClone({ ...pin, id: pin.id ?? this.nextId() });
    const role = pin.role || 'single';
    if (role === 'single') {
      this.queue = [pin];
      return;
    }

    if (role === 'target' || role === 'reference') {
      // Keep A/B pairing unambiguous by replacing only the matching slot and any prior single pick.
      this.queue = this.queue.filter(p => p.role !== role && p.role !== 'single');
      this.queue.push(pin);
    } else {
      this.queue = this.queue.filter(p => p.role !== 'single');
      this.queue.push(pin);
    }

    if (this.queue.length > TOKEN_BUDGETS.MAX_PIN_QUEUE) {
      this.queue.shift();
    }
  }

  public getPins(clearAfterRead = false, includeScreenshot = true): { pins: PickedElementInfo[]; comparison?: ComparisonDiff } | null {
    if (this.queue.length === 0) return null;

    const view = includeScreenshot ? this.queue : this.queue.map(({ screenshotBase64: _image, ...pin }) => pin);
    const pins = structuredClone(view);
    const comparison = this.buildComparison(pins);

    if (clearAfterRead) {
      this.queue = [];
    }

    return {
      pins,
      ...(comparison ? { comparison } : {})
    };
  }

  public buildComparison(pins: PickedElementInfo[] = this.queue): ComparisonDiff | undefined {
    const targetPin = pins.find(p => p.role === 'target');
    const refPin = pins.find(p => p.role === 'reference');
    return targetPin && refPin ? computeComparisonDiff(targetPin, refPin) : undefined;
  }

  public clear(): number {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }

  public consume(pins: PickedElementInfo[]): void {
    const ids = new Set(pins.map(pin => pin.id));
    this.queue = this.queue.filter(pin => !ids.has(pin.id));
  }
}

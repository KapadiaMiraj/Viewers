/**
 * Simple module-level event buses for sharing measurements
 * between the ECGWaveformViewport and ECGMeasurementsPanel
 * without creating circular imports.
 */

// ─── HR Bus ───────────────────────────────────────────────────────────────────

export type HRRecord = { id: number; rrSec: number; hrBpm: number };

class HRBus {
  private _records: HRRecord[] = [];
  private _listeners: Array<(records: HRRecord[]) => void> = [];

  add(record: HRRecord) {
    this._records = [...this._records, record];
    this._listeners.forEach(fn => fn(this._records));
  }

  clear() {
    this._records = [];
    this._listeners.forEach(fn => fn([]));
  }

  subscribe(fn: (records: HRRecord[]) => void): () => void {
    this._listeners.push(fn);
    // Immediately call with current records
    fn(this._records);
    return () => {
      const idx = this._listeners.indexOf(fn);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  get records(): HRRecord[] {
    return this._records;
  }
}

export const hrBus = new HRBus();

// ─── Measurement Rectangle Bus ────────────────────────────────────────────────

export type RectRecord = {
  id: number;
  timeSec: number;
  voltMv: number;
  bpm: number;
};

class RectBus {
  private _records: RectRecord[] = [];
  private _listeners: Array<(records: RectRecord[]) => void> = [];

  add(record: RectRecord) {
    this._records = [...this._records, record];
    this._listeners.forEach(fn => fn(this._records));
  }

  clear() {
    this._records = [];
    this._listeners.forEach(fn => fn([]));
  }

  subscribe(fn: (records: RectRecord[]) => void): () => void {
    this._listeners.push(fn);
    fn(this._records);
    return () => {
      const idx = this._listeners.indexOf(fn);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  get records(): RectRecord[] {
    return this._records;
  }
}

export const rectBus = new RectBus();

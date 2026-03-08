import React, { useEffect, useState, useCallback } from 'react';
import { ecgToolState } from '../ecgToolState';
import { hrBus, HRRecord, rectBus, RectRecord } from '../hrBus';

// ── Small metric card component ────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  unit,
  accent = '#4facfe',
  alert = null,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: string;
  alert?: { text: string; color: string } | null;
}) {
  return (
    <div
      style={{
        background: '#10152a',
        border: `1px solid ${accent}33`,
        borderRadius: 6,
        padding: '8px 10px',
        marginBottom: 6,
      }}
    >
      <div style={{ color: '#7a8aaa', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 'bold', color: '#fff' }}>
        {value}
        {unit && <span style={{ color: '#7a8aaa', fontSize: 11, marginLeft: 4 }}>{unit}</span>}
      </div>
      {alert && <div style={{ color: alert.color, fontSize: 10, marginTop: 2 }}>{alert.text}</div>}
    </div>
  );
}

// ── HR Variance sparkline (simple bar mini-chart) ─────────────────────────────
function HRVarianceChart({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: '#7a8aaa', fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: 36, gap: 3 }}>
        {values.map((v, i) => {
          const h = Math.max(4, ((v - min) / range) * 32 + 4);
          return (
            <div
              key={i}
              title={`${v.toFixed(1)}`}
              style={{
                flex: 1,
                height: h,
                background: `hsl(${200 + ((v - min) / range) * 60}, 70%, 55%)`,
                borderRadius: 2,
                transition: 'height 0.2s',
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: '#5a6a8a',
          fontSize: 9,
          marginTop: 2,
        }}
      >
        <span>{min.toFixed(1)}</span>
        <span>{max.toFixed(1)}</span>
      </div>
    </div>
  );
}

// hrBus and HRRecord type are imported from '../hrBus'

// ─── Main Panel Component ─────────────────────────────────────────────────────

const ECGMeasurementsPanel = ({ servicesManager }) => {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [hrRecords, setHrRecords] = useState<HRRecord[]>([]);
  const [baselineHR, setBaselineHR] = useState<number | null>(null);

  // Subscribe to active tool
  useEffect(() => {
    const unsub = ecgToolState.subscribe(tool => setActiveTool(tool));
    setActiveTool(ecgToolState.getActiveTool());
    return unsub;
  }, []);

  // Subscribe to HR measurements from the viewport
  useEffect(() => {
    const unsub = hrBus.subscribe(records => setHrRecords([...records]));
    setHrRecords([...hrBus.records]);
    return unsub;
  }, []);

  // Subscribe to Measurement (rectangle) measurements
  const [rectRecords, setRectRecords] = useState<RectRecord[]>([]);
  useEffect(() => {
    const unsub = rectBus.subscribe(records => setRectRecords([...records]));
    setRectRecords([...rectBus.records]);
    return unsub;
  }, []);

  // ── HR Variance calculations ──────────────────────────────────────────────
  const hrValues = hrRecords.map(r => r.hrBpm);
  const rrValues = hrRecords.map(r => r.rrSec * 1000); // ms

  const avgHR = hrValues.length > 0 ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length : null;

  const avgRR = rrValues.length > 0 ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : null;

  const sdnn =
    rrValues.length >= 2
      ? Math.sqrt(
          rrValues.reduce((acc, rr) => acc + Math.pow(rr - (avgRR || 0), 2), 0) / rrValues.length
        )
      : null;

  const rmssd =
    rrValues.length >= 2
      ? Math.sqrt(
          rrValues.slice(1).reduce((acc, rr, i) => acc + Math.pow(rr - rrValues[i], 2), 0) /
            (rrValues.length - 1)
        )
      : null;

  const maxRR = rrValues.length > 0 ? Math.max(...rrValues) : null;
  const minRR = rrValues.length > 0 ? Math.min(...rrValues) : null;

  const handleSetBaseline = useCallback(() => {
    if (avgHR !== null) setBaselineHR(avgHR);
  }, [avgHR]);

  const handleClearHR = useCallback(() => {
    hrBus.clear();
    setBaselineHR(null);
  }, []);

  return (
    <div
      style={{
        padding: '12px',
        color: '#fff',
        fontSize: 13,
        background: '#090c14',
        height: '100%',
        overflowY: 'auto',
        fontFamily: 'monospace',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <h2
        style={{
          fontSize: 15,
          marginBottom: 12,
          borderBottom: '1px solid #1e2a4a',
          paddingBottom: 8,
          color: '#4facfe',
          letterSpacing: 1,
        }}
      >
        ⚡ ECG Tools
      </h2>

      {/* Active tool indicator */}
      <div
        style={{
          background: activeTool ? '#101e3a' : '#0d1020',
          border: `1px solid ${activeTool ? '#4facfe44' : '#1e2a4a'}`,
          borderRadius: 6,
          padding: '6px 10px',
          marginBottom: 12,
          fontSize: 11,
        }}
      >
        <span style={{ color: '#5a6a8a' }}>Active tool: </span>
        <span style={{ color: activeTool ? '#00e676' : '#5a6a8a', fontWeight: 'bold' }}>
          {activeTool ?? 'None — select from toolbar'}
        </span>
      </div>

      {/* ── Measurement (Rectangle) Section ── */}
      {rectRecords.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <h3 style={{ fontSize: 13, color: '#aabbff', margin: 0 }}>📐 Measurements</h3>
            <button
              onClick={() => {
                rectBus.clear();
                setRectRecords([]);
              }}
              style={{
                background: '#e5393533',
                color: '#ff6666',
                border: '1px solid #e5393555',
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              Clear
            </button>
          </div>
          {rectRecords.map((r, i) => (
            <div
              key={r.id}
              style={{
                background: i % 2 === 0 ? '#0d1525' : '#0a1020',
                borderRadius: 4,
                padding: '5px 8px',
                marginBottom: 3,
                fontSize: 11,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 4,
                border: '1px solid #5577ff22',
              }}
            >
              <div>
                <span style={{ color: '#5a6a8a' }}>t </span>
                <span style={{ color: '#aabbff', fontWeight: 'bold' }}>
                  {r.timeSec.toFixed(2)} s
                </span>
              </div>
              <div>
                <span style={{ color: '#5a6a8a' }}>V </span>
                <span style={{ color: '#aabbff', fontWeight: 'bold' }}>
                  {r.voltMv.toFixed(2)} mV
                </span>
              </div>
              <div>
                <span style={{ color: '#5a6a8a' }}>⟳ </span>
                <span style={{ color: '#66ff99', fontWeight: 'bold' }}>
                  {Math.round(r.bpm)} bpm
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Heart Rate Measurements Section ── */}

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <h3 style={{ fontSize: 13, color: '#88aaff', margin: 0 }}>❤ HR Measurements</h3>
          {hrRecords.length > 0 && (
            <button
              onClick={handleClearHR}
              style={{
                background: '#e5393533',
                color: '#ff6666',
                border: '1px solid #e5393555',
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              Clear
            </button>
          )}
        </div>

        {hrRecords.length === 0 ? (
          <div style={{ color: '#3a4a6a', fontSize: 11, padding: '8px 0' }}>
            Select the HR tool and click two R-peaks on the waveform.
          </div>
        ) : (
          <>
            {/* Summary metrics */}
            {avgHR !== null && (
              <MetricCard
                label="Average HR"
                value={avgHR.toFixed(1)}
                unit="bpm"
                accent="#88aaff"
                alert={
                  avgHR > 100
                    ? { text: '⚠ Tachycardia', color: '#ff8866' }
                    : avgHR < 60
                      ? { text: '⚠ Bradycardia', color: '#ffcc66' }
                      : { text: '✓ Normal', color: '#66ff99' }
                }
              />
            )}
            {avgRR !== null && (
              <MetricCard
                label="Avg RR Interval"
                value={avgRR.toFixed(1)}
                unit="ms"
                accent="#88aaff"
              />
            )}

            {/* Individual measurements */}
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#5a6a8a', fontSize: 10, marginBottom: 4 }}>
                Measurements ({hrRecords.length})
              </div>
              {hrRecords.map((r, i) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    background: i % 2 === 0 ? '#10152a' : '#0d1020',
                    borderRadius: 4,
                    marginBottom: 2,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: '#5a6a8a' }}>#{i + 1}</span>
                  <span style={{ color: '#aac0ff' }}>{(r.rrSec * 1000).toFixed(0)} ms</span>
                  <span style={{ color: '#00e676', fontWeight: 'bold' }}>
                    {Math.round(r.hrBpm)} bpm
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Interval Variance Section ── */}
      {hrRecords.length >= 2 && (
        <div
          style={{
            background: '#0d1525',
            border: '1px solid #5577ff33',
            borderRadius: 8,
            padding: 10,
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 12, color: '#88aaff', marginBottom: 8 }}>
            📊 Interval Variance (HRV)
          </h3>

          <HRVarianceChart
            values={hrValues}
            label="HR per beat (bpm)"
          />
          <HRVarianceChart
            values={rrValues}
            label="RR interval (ms)"
          />

          {sdnn !== null && (
            <MetricCard
              label="SDNN"
              value={sdnn.toFixed(1)}
              unit="ms"
              accent="#5577ff"
              alert={
                sdnn < 20
                  ? { text: '⚠ Very Low HRV — possible risk', color: '#ff6666' }
                  : sdnn < 50
                    ? { text: '↓ Low HRV', color: '#ffaa44' }
                    : { text: '✓ Healthy HRV', color: '#66ff99' }
              }
            />
          )}
          {rmssd !== null && (
            <MetricCard
              label="RMSSD"
              value={rmssd.toFixed(1)}
              unit="ms"
              accent="#5577ff"
            />
          )}
          {maxRR !== null && minRR !== null && (
            <MetricCard
              label="ΔRR (max − min)"
              value={(maxRR - minRR).toFixed(0)}
              unit="ms"
              accent="#5577ff"
            />
          )}
        </div>
      )}

      {/* ── Baseline Comparison Section ── */}
      {hrRecords.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 12, color: '#4facfe', marginBottom: 8 }}>⟳ Baseline Comparison</h3>
          {baselineHR === null ? (
            <button
              onClick={handleSetBaseline}
              disabled={avgHR === null}
              style={{
                background: '#4facfe',
                color: '#fff',
                border: 'none',
                padding: '7px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                width: '100%',
                fontSize: 11,
                opacity: avgHR === null ? 0.5 : 1,
              }}
            >
              Set Current as Baseline
            </button>
          ) : (
            <div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    background: '#0d1020',
                    borderRadius: 6,
                    padding: '6px 8px',
                    border: '1px solid #2a3a5a',
                  }}
                >
                  <div style={{ color: '#5a6a8a', fontSize: 10 }}>Baseline</div>
                  <div style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>
                    {baselineHR.toFixed(1)}{' '}
                    <span style={{ color: '#5a6a8a', fontSize: 10 }}>bpm</span>
                  </div>
                </div>
                <div
                  style={{
                    background: '#0d1020',
                    borderRadius: 6,
                    padding: '6px 8px',
                    border: '1px solid #2a3a5a',
                  }}
                >
                  <div style={{ color: '#5a6a8a', fontSize: 10 }}>Current Avg</div>
                  <div style={{ color: '#00e676', fontWeight: 'bold', fontSize: 14 }}>
                    {avgHR?.toFixed(1)} <span style={{ color: '#5a6a8a', fontSize: 10 }}>bpm</span>
                  </div>
                </div>
              </div>
              {avgHR !== null && (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    background:
                      Math.abs(avgHR - baselineHR) > 15
                        ? '#3a0a0a'
                        : Math.abs(avgHR - baselineHR) > 8
                          ? '#2a2000'
                          : '#0a2a0a',
                    color:
                      Math.abs(avgHR - baselineHR) > 15
                        ? '#ff6666'
                        : Math.abs(avgHR - baselineHR) > 8
                          ? '#ffcc44'
                          : '#66ff99',
                    fontSize: 11,
                    marginBottom: 6,
                  }}
                >
                  {avgHR > baselineHR ? '↑' : '↓'} {Math.abs(avgHR - baselineHR).toFixed(1)} bpm
                  from baseline
                  {Math.abs(avgHR - baselineHR) > 15 && ' — Significant change'}
                  {Math.abs(avgHR - baselineHR) <= 8 && ' — Stable'}
                </div>
              )}
              <button
                onClick={() => setBaselineHR(null)}
                style={{
                  background: '#e5393533',
                  color: '#ff6666',
                  border: '1px solid #e5393555',
                  padding: '5px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  width: '100%',
                  fontSize: 11,
                }}
              >
                Clear Baseline
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Help Section ── */}
      <div
        style={{
          background: '#0d1020',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 10,
          color: '#3a4a6a',
          lineHeight: 1.6,
        }}
      >
        <div style={{ color: '#4a5a7a', marginBottom: 4, fontWeight: 'bold' }}>Quick Guide</div>
        <div>
          ❤ <strong>HR:</strong> Click toolbar → click 2 R-peaks
        </div>
        <div>
          📐 <strong>Measure:</strong> Click corner → click opposite corner
        </div>
        <div>
          🎯 <strong>QT:</strong> Q onset → T end → next Q onset
        </div>
        <div>
          ⌨ <strong>Esc</strong> to cancel any active measurement
        </div>
      </div>
    </div>
  );
};

export default ECGMeasurementsPanel;

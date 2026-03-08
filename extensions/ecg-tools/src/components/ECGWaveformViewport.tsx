import React, { useEffect, useState, useRef, useCallback } from 'react';
import { DicomMetadataStore } from '@ohif/core';
import { ecgToolState } from '../ecgToolState';
import { hrBus, rectBus, qrsBus } from '../hrBus';

const LEAD_NAMES = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

// ─── DICOM Waveform Parser ─────────────────────────────────────────────────────

function parseWaveformData(instance) {
  try {
    const waveformSequence =
      instance['54000100'] || instance.WaveformSequence || instance['x54000100'];
    if (!waveformSequence) return null;

    const sequences = Array.isArray(waveformSequence)
      ? waveformSequence
      : waveformSequence.Value || [];

    const leads: any[] = [];

    for (const seq of sequences) {
      const channelDef =
        seq['003a0200'] || seq.WaveformChannelDefinitionSequence || seq['x003a0200'];
      const waveformData = seq['54001010'] || seq.WaveformData || seq['x54001010'];
      const samplesPerChannel = seq['003a0010']?.Value?.[0] || seq.NumberOfWaveformSamples || 5000;
      const samplingFreq = seq['003a001a']?.Value?.[0] || seq.SamplingFrequency || 500;
      const numChannels = seq['003a0005']?.Value?.[0] || seq.NumberOfWaveformChannels || 12;

      if (!waveformData) continue;

      let rawData: Int16Array;
      if (waveformData.InlineBinary) {
        const binaryStr = atob(waveformData.InlineBinary);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        rawData = new Int16Array(bytes.buffer);
      } else if (waveformData.Value) {
        rawData = new Int16Array(waveformData.Value);
      } else {
        continue;
      }

      const channels = Array.isArray(channelDef) ? channelDef : channelDef?.Value || [];

      for (let ch = 0; ch < numChannels; ch++) {
        const channelData: number[] = [];
        for (let s = 0; s < samplesPerChannel; s++)
          channelData.push(rawData[s * numChannels + ch] || 0);

        const chDef = channels[ch] || {};
        const sensitivity = chDef['003a0210']?.Value?.[0] || chDef.ChannelSensitivity || 1;
        const units = chDef['003a0211']?.Value?.[0] || 'uV';
        const scaleFactor =
          typeof units === 'string' && units.includes('uV') ? sensitivity / 1000 : sensitivity;

        leads.push({
          name: LEAD_NAMES[ch] || `Lead ${ch + 1}`,
          data: channelData.map(v => v * scaleFactor),
          samplingFreq,
          samplesPerChannel,
        });
      }
    }
    return leads.length > 0 ? leads : null;
  } catch (e) {
    console.warn('[ECGViewport] Parse error:', e);
    return null;
  }
}

// ─── Demo ECG Generator ────────────────────────────────────────────────────────

function generateDemoECG() {
  const samplingFreq = 500;
  const durationSec = 10;
  const samples = samplingFreq * durationSec;
  const heartRate = 72;
  const rrSamples = Math.round((60 / heartRate) * samplingFreq);

  function singleBeat(amp = 1) {
    const beat = new Array(rrSamples).fill(0);
    const t = rrSamples;
    const pS = Math.round(0.05 * t),
      pE = Math.round(0.15 * t);
    for (let i = pS; i < pE; i++) beat[i] = amp * 0.15 * Math.sin((Math.PI * (i - pS)) / (pE - pS));
    const q = Math.round(0.22 * t);
    beat[q] = -amp * 0.1;
    beat[q + 1] = amp * 0.1;
    beat[q + 2] = amp * 1.2;
    beat[q + 3] = -amp * 0.25;
    beat[q + 4] = -amp * 0.05;
    const tS = Math.round(0.35 * t),
      tE = Math.round(0.55 * t);
    for (let i = tS; i < tE; i++) beat[i] = amp * 0.35 * Math.sin((Math.PI * (i - tS)) / (tE - tS));
    return beat;
  }

  return LEAD_NAMES.map((name, li) => {
    const amps = [1, 0.8, -0.3, -0.8, 0.5, 0.6, 0.3, 0.6, 0.9, 1.1, 1.0, 0.9];
    const data: number[] = [];
    for (let b = 0; b < Math.ceil(samples / rrSamples); b++)
      data.push(...singleBeat(amps[li] || 1));
    return {
      name,
      data: data.slice(0, samples).map(v => v + (Math.random() - 0.5) * 0.01),
      samplingFreq,
      samplesPerChannel: samples,
    };
  });
}

// ─── SVG Waveform Path ────────────────────────────────────────────────────────

function getWaveformPath(data: number[], width: number, height: number) {
  if (!data?.length) return '';
  const maxPts = 2000;
  const step = Math.max(1, Math.floor(data.length / maxPts));
  const pts: number[] = [];
  for (let i = 0; i < data.length; i += step) pts.push(data[i]);
  const min = Math.min(...pts),
    max = Math.max(...pts);
  const range = max - min || 1;
  const scale = (height * 0.72) / range;
  const stepX = width / pts.length;
  return pts
    .map((v, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (height / 2 - (v - (min + max) / 2) * scale).toFixed(1);
      return (i === 0 ? 'M' : 'L') + `${x},${y}`;
    })
    .join(' ');
}

// ─── ECG Grid ─────────────────────────────────────────────────────────────────

function ECGGrid({ width, height }: { width: number; height: number }) {
  const cell = 20;
  return (
    <g>
      {Array.from({ length: Math.floor(height / cell) }, (_, i) => (
        <line
          key={`h${i}`}
          x1={0}
          y1={(i + 1) * cell}
          x2={width}
          y2={(i + 1) * cell}
          stroke={i % 5 === 4 ? '#ff000055' : '#ff000022'}
          strokeWidth={i % 5 === 4 ? 0.8 : 0.3}
        />
      ))}
      {Array.from({ length: Math.floor(width / cell) }, (_, i) => (
        <line
          key={`v${i}`}
          x1={(i + 1) * cell}
          y1={0}
          x2={(i + 1) * cell}
          y2={height}
          stroke={i % 5 === 4 ? '#ff000055' : '#ff000022'}
          strokeWidth={i % 5 === 4 ? 0.8 : 0.3}
        />
      ))}
    </g>
  );
}

// ─── Point Marker (Q / T label box) ───────────────────────────────────────────

function PointMarker({
  x,
  y,
  label,
  color,
}: {
  x: number;
  y: number;
  label: string;
  color: string;
}) {
  return (
    <g>
      {/* Vertical tick line */}
      <line
        x1={x}
        y1={y - 40}
        x2={x}
        y2={y + 5}
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Label box */}
      <rect
        x={x - 8}
        y={y - 55}
        width={16}
        height={14}
        rx={2}
        fill={color + 'cc'}
      />
      <text
        x={x}
        y={y - 44}
        textAnchor="middle"
        fill="#fff"
        fontSize={9}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {label}
      </text>
    </g>
  );
}

// ─── Completed QT Measurement Shape ───────────────────────────────────────────

interface QTMeasurement {
  id: number;
  q1: { x: number; y: number };
  t: { x: number; y: number };
  q2: { x: number; y: number };
  rrSec: number;
  qtSec: number;
  qtcSec: number;
}

function QTMeasurementShape({ m }: { m: QTMeasurement }) {
  const { q1, t, q2, rrSec, qtSec, qtcSec } = m;
  const midY = Math.max(q1.y, t.y, q2.y) + 28;
  const labelX = (q1.x + q2.x) / 2;
  const label = `RR=${rrSec.toFixed(2)} s    QT=${qtSec.toFixed(3)} s    QTc=${qtcSec.toFixed(3)} s`;

  return (
    <g>
      {/* Q1 vertical line */}
      <line
        x1={q1.x}
        y1={q1.y - 40}
        x2={q1.x}
        y2={midY - 5}
        stroke="#5bc8f5"
        strokeWidth={1.5}
      />
      {/* T vertical line */}
      <line
        x1={t.x}
        y1={t.y - 40}
        x2={t.x}
        y2={midY - 5}
        stroke="#5bc8f5"
        strokeWidth={1.5}
      />
      {/* Q2 vertical line */}
      <line
        x1={q2.x}
        y1={q2.y - 40}
        x2={q2.x}
        y2={midY - 5}
        stroke="#5bc8f5"
        strokeWidth={1.5}
      />
      {/* Diagonal line T → Q2 */}
      <line
        x1={t.x}
        y1={t.y - 10}
        x2={q2.x}
        y2={q2.y - 10}
        stroke="#5bc8f5"
        strokeWidth={1.5}
      />
      {/* Q1 → T horizontal (QT span) */}
      <line
        x1={q1.x}
        y1={q1.y - 10}
        x2={t.x}
        y2={t.y - 10}
        stroke="#5bc8f5"
        strokeWidth={1.5}
      />
      {/* Bottom baseline connecting q1 → q2 */}
      <line
        x1={q1.x}
        y1={midY - 5}
        x2={q2.x}
        y2={midY - 5}
        stroke="#5bc8f5"
        strokeWidth={1}
        strokeDasharray="4 2"
      />
      {/* Q1 label */}
      <PointMarker
        x={q1.x}
        y={q1.y}
        label="Q"
        color="#5bc8f5"
      />
      {/* T label */}
      <PointMarker
        x={t.x}
        y={t.y}
        label="T"
        color="#5bc8f5"
      />
      {/* Q2 label */}
      <PointMarker
        x={q2.x}
        y={q2.y}
        label="Q"
        color="#5bc8f5"
      />
      {/* Measurement label */}
      <rect
        x={labelX - label.length * 3.1}
        y={midY + 2}
        width={label.length * 6.2}
        height={15}
        rx={3}
        fill="#0a0e1acc"
      />
      <text
        x={labelX}
        y={midY + 13}
        textAnchor="middle"
        fill="#5bc8f5"
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {label}
      </text>
    </g>
  );
}

// ─── In-progress QT Tool Preview ──────────────────────────────────────────────

interface ActiveQTState {
  step: 1 | 2 | 3; // 1=placed Q1, 2=placed T, drawing Q2
  q1?: { x: number; y: number };
  t?: { x: number; y: number };
  cursor?: { x: number; y: number };
}

function ActiveQTPreview({ state }: { state: ActiveQTState }) {
  const { step, q1, t, cursor } = state;
  return (
    <g opacity={0.75}>
      {q1 && (
        <PointMarker
          x={q1.x}
          y={q1.y}
          label="Q"
          color="#5bc8f5"
        />
      )}
      {t && (
        <>
          <PointMarker
            x={t.x}
            y={t.y}
            label="T"
            color="#5bc8f5"
          />
          {/* Q1→T line */}
          <line
            x1={q1!.x}
            y1={q1!.y - 10}
            x2={t.x}
            y2={t.y - 10}
            stroke="#5bc8f5"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
        </>
      )}
      {/* Live preview line following cursor */}
      {step === 2 && cursor && q1 && (
        <line
          x1={q1.x}
          y1={q1.y}
          x2={cursor.x}
          y2={cursor.y}
          stroke="#5bc8f5"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      {step === 3 && cursor && t && (
        <>
          <PointMarker
            x={cursor.x}
            y={cursor.y}
            label="Q"
            color="#5bc8f5cc"
          />
          <line
            x1={t.x}
            y1={t.y - 10}
            x2={cursor.x}
            y2={cursor.y - 10}
            stroke="#5bc8f5"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
        </>
      )}
    </g>
  );
}

// ─── Measurement Rectangle Tool ───────────────────────────────────────────────

interface RectMeasurement {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  timeSec: number; // horizontal span converted to seconds
  voltMv: number; // vertical span converted to mV (approximate)
  bpm: number; // 60 / timeSec
}

interface ActiveRectState {
  x1: number;
  y1: number;
  cursorX: number;
  cursorY: number;
}

/**
 * A completed measurement rectangle — blue border, labels at the right edge.
 * Matches the style in the EchoPAC screenshots (blue box + "2.02 s / 1.70 mV / 29 bpm").
 */
function RectMeasurementShape({ m }: { m: RectMeasurement }) {
  const rx = Math.min(m.x1, m.x2);
  const ry = Math.min(m.y1, m.y2);
  const rw = Math.abs(m.x2 - m.x1);
  const rh = Math.abs(m.y2 - m.y1);

  // Label appears at the right edge of the rectangle, vertically centred
  const lx = Math.max(m.x1, m.x2) + 6;
  const ly = (m.y1 + m.y2) / 2;

  const line1 = `${m.timeSec.toFixed(2)} s`;
  const line2 = `${m.voltMv.toFixed(2)} mV`;
  const line3 = `${Math.round(m.bpm)} bpm`;

  return (
    <g>
      {/* Rectangle border */}
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        fill="none"
        stroke="#7799ff"
        strokeWidth={1.5}
        rx={2}
      />
      {/* Subtle fill */}
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        fill="#5577ff11"
        rx={2}
      />
      {/* Corner dots */}
      {[
        [rx, ry],
        [rx + rw, ry],
        [rx, ry + rh],
        [rx + rw, ry + rh],
      ].map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={3}
          fill="#7799ff"
        />
      ))}
      {/* Measurement label box */}
      <rect
        x={lx - 2}
        y={ly - 28}
        width={72}
        height={52}
        rx={4}
        fill="#0a0e1add"
        stroke="#7799ff44"
        strokeWidth={1}
      />
      <text
        x={lx + 2}
        y={ly - 15}
        fill="#aabbff"
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {line1}
      </text>
      <text
        x={lx + 2}
        y={ly + 1}
        fill="#aabbff"
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {line2}
      </text>
      <text
        x={lx + 2}
        y={ly + 17}
        fill="#aabbff"
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {line3}
      </text>
    </g>
  );
}

/**
 * Live preview of the rectangle being drawn (dashed border, semi-transparent).
 */
function ActiveRectPreview({
  state,
  timeSec,
  voltMv,
  bpm,
}: {
  state: ActiveRectState;
  timeSec: number;
  voltMv: number;
  bpm: number;
}) {
  const rx = Math.min(state.x1, state.cursorX);
  const ry = Math.min(state.y1, state.cursorY);
  const rw = Math.abs(state.cursorX - state.x1);
  const rh = Math.abs(state.cursorY - state.y1);
  const lx = Math.max(state.x1, state.cursorX) + 6;
  const ly = (state.y1 + state.cursorY) / 2;

  return (
    <g opacity={0.85}>
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        fill="#5577ff18"
        stroke="#7799ff"
        strokeWidth={1.5}
        strokeDasharray="6 3"
        rx={2}
      />
      {/* Crosshair at anchor */}
      <line
        x1={state.x1 - 6}
        y1={state.y1}
        x2={state.x1 + 6}
        y2={state.y1}
        stroke="#7799ff"
        strokeWidth={1}
      />
      <line
        x1={state.x1}
        y1={state.y1 - 6}
        x2={state.x1}
        y2={state.y1 + 6}
        stroke="#7799ff"
        strokeWidth={1}
      />
      {/* Live label */}
      {rw > 10 && (
        <>
          <rect
            x={lx - 2}
            y={ly - 28}
            width={72}
            height={52}
            rx={4}
            fill="#0a0e1add"
            stroke="#7799ff44"
            strokeWidth={1}
          />
          <text
            x={lx + 2}
            y={ly - 15}
            fill="#aabbff"
            fontSize={11}
            fontFamily="monospace"
            fontWeight="bold"
          >
            {timeSec.toFixed(2)} s
          </text>
          <text
            x={lx + 2}
            y={ly + 1}
            fill="#aabbff"
            fontSize={11}
            fontFamily="monospace"
            fontWeight="bold"
          >
            {voltMv.toFixed(2)} mV
          </text>
          <text
            x={lx + 2}
            y={ly + 17}
            fill="#aabbff"
            fontSize={11}
            fontFamily="monospace"
            fontWeight="bold"
          >
            {Math.round(bpm)} bpm
          </text>
        </>
      )}
    </g>
  );
}

// ─── QRS Axis Measurement Types ────────────────────────────────────────────────

interface QRSAxisMeasurement {
  id: number;
  x1: number;
  x2: number;
  axisDeg: number;
  boundsI: { max: number; min: number; baseline: number };
  boundsaVF: { max: number; min: number; baseline: number };
}

interface ActiveQRSAxisState {
  x1: number;
  cursorX: number;
}

function QRSAxisMeasurementShape({
  m,
  svgH,
  leads,
  cols,
  leadW,
  leadH,
}: {
  m: QRSAxisMeasurement;
  svgH: number;
  leads: any[];
  cols: number;
  leadW: number;
  leadH: number;
}) {
  const { x1, x2, axisDeg, boundsI, boundsaVF } = m;
  const labelText = `${axisDeg.toFixed(2)}°`;
  const labelWidth = labelText.length * 8 + 12;

  const iIndex = leads?.findIndex(l => l.name === 'I');
  const aVFIndex = leads?.findIndex(l => l.name === 'aVF');

  // Helper to project value to Y
  function getLeadVisualY(v: number, leadData: number[], height: number) {
    if (!leadData?.length) return 0;
    const maxPts = 2000;
    const step = Math.max(1, Math.floor(leadData.length / maxPts));
    let min = leadData[0],
      max = leadData[0];
    for (let i = 0; i < leadData.length; i += step) {
      if (leadData[i] < min) min = leadData[i];
      if (leadData[i] > max) max = leadData[i];
    }
    const range = max - min || 1;
    const scale = (height * 0.72) / range;
    return height / 2 - (v - (min + max) / 2) * scale;
  }

  return (
    <g>
      <line
        x1={x1}
        y1={0}
        x2={x1}
        y2={svgH}
        stroke="#aaddff"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <line
        x1={x2}
        y1={0}
        x2={x2}
        y2={svgH}
        stroke="#aaddff"
        strokeWidth={1}
        strokeDasharray="3 3"
      />

      {[iIndex, aVFIndex].map(idx => {
        if (idx === undefined || idx < 0) return null;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const ry = row * leadH;

        // Calculate local coordinates relative to the clicked column
        const clickCol = Math.floor(Math.min(x1, x2) / leadW);
        const localX1 = Math.min(x1, x2) - clickCol * leadW;
        const widthPx = Math.abs(x2 - x1);

        // Transform the local X into the visual column of THIS lead
        const boxX = col * leadW + localX1;

        const lead = leads[idx];
        const isI = lead.name === 'I';
        const bounds = isI ? boundsI : boundsaVF;

        if (!bounds || !lead) return null;

        const yTop = getLeadVisualY(bounds.max, lead.data, leadH);
        const yBottom = getLeadVisualY(bounds.min, lead.data, leadH);

        const boxY = ry + Math.min(yTop, yBottom);
        const boxH = Math.abs(yBottom - yTop);

        return (
          <g key={idx}>
            <rect
              x={boxX}
              y={boxY}
              width={widthPx}
              height={Math.max(boxH, 1)}
              fill="none"
              stroke="#ff4444"
              strokeWidth={1.2}
            />
            {/* Baseline horizontal line reference */}
            <line
              x1={boxX}
              y1={ry + getLeadVisualY(bounds.baseline, lead.data, leadH)}
              x2={boxX + widthPx}
              y2={ry + getLeadVisualY(bounds.baseline, lead.data, leadH)}
              stroke="#ff4444"
              strokeWidth={0.8}
              strokeDasharray="2 2"
            />
          </g>
        );
      })}

      <rect
        x={Math.max(x1, x2) + 4}
        y={svgH / 2 - 12}
        width={labelWidth}
        height={24}
        rx={4}
        fill="#0a0e1add"
        stroke="#ff775544"
        strokeWidth={1}
      />
      <text
        x={Math.max(x1, x2) + 4 + labelWidth / 2}
        y={svgH / 2 + 4}
        textAnchor="middle"
        fill="#ffbb88"
        fontSize={12}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {labelText}
      </text>
    </g>
  );
}

function ActiveQRSPreview({ state, svgH }: { state: ActiveQRSAxisState; svgH: number }) {
  const { x1, cursorX } = state;
  const minX = Math.min(x1, cursorX);
  const maxX = Math.max(x1, cursorX);

  return (
    <g opacity={0.7}>
      <line
        x1={x1}
        y1={0}
        x2={x1}
        y2={svgH}
        stroke="#aaddff"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <line
        x1={cursorX}
        y1={0}
        x2={cursorX}
        y2={svgH}
        stroke="#aaddff"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <rect
        x={minX}
        y={0}
        width={maxX - minX}
        height={svgH}
        fill="#ff555511"
        stroke="none"
      />
    </g>
  );
}

// ─── HR Measurement Types ─────────────────────────────────────────────────────

interface HRMeasurement {
  id: number;
  x1: number; // pixel position of first R-peak
  x2: number; // pixel position of second R-peak
  rrSec: number;
  hrBpm: number;
  svgH: number; // total svg height for spanning lines
}

interface ActiveHRState {
  x1: number; // anchor x position
  cursorX: number;
}

// ─── Full-height Vertical Ruler Lines for HR tool ─────────────────────────────

/**
 * Renders 4 vertical lines spanning the full ECG viewport height:
 *  Line 1: at x1 (anchor click)
 *  Lines 2-4: evenly spaced between x1 and x2, for interval variance visual
 *  Shows RR interval (s) and HR (BPM) at the midpoint
 */
function HRRulerLines({
  x1,
  x2,
  svgH,
  rrSec,
  hrBpm,
  isDashed = false,
  opacity = 1,
}: {
  x1: number;
  x2: number;
  svgH: number;
  rrSec: number;
  hrBpm: number;
  isDashed?: boolean;
  opacity?: number;
}) {
  const midX = (x1 + x2) / 2;
  const span = x2 - x1;
  // Four lines: x1, x1+span/3, x1+2*span/3, x2
  const linePositions = [x1, x1 + span / 3, x1 + (2 * span) / 3, x2];
  const labelText = `${rrSec.toFixed(2)} s`;
  const hrText = `HR ${Math.round(hrBpm)}`;
  const labelWidth = Math.max(labelText.length, hrText.length) * 7.5 + 8;

  return (
    <g opacity={opacity}>
      {linePositions.map((lx, i) => (
        <line
          key={i}
          x1={lx}
          y1={0}
          x2={lx}
          y2={svgH}
          stroke="#5577ff"
          strokeWidth={i === 0 || i === 3 ? 1.8 : 1.2}
          strokeDasharray={isDashed ? '5 3' : i === 1 || i === 2 ? '4 4' : 'none'}
        />
      ))}
      {/* Label box at midpoint */}
      <rect
        x={midX - labelWidth / 2}
        y={svgH * 0.33 - 22}
        width={labelWidth}
        height={32}
        rx={4}
        fill="#0a0e1acc"
        stroke="#5577ff44"
        strokeWidth={1}
      />
      <text
        x={midX}
        y={svgH * 0.33 - 10}
        textAnchor="middle"
        fill="#88aaff"
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {labelText}
      </text>
      <text
        x={midX}
        y={svgH * 0.33 + 4}
        textAnchor="middle"
        fill="#88aaff"
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {hrText}
      </text>
    </g>
  );
}

// ─── HR Interval Variance Panel ───────────────────────────────────────────────

interface HRVarianceProps {
  measurements: HRMeasurement[];
}

function HRVariancePanel({ measurements }: HRVarianceProps) {
  if (measurements.length < 2) return null;

  const hrs = measurements.map(m => m.hrBpm);
  const rrs = measurements.map(m => m.rrSec * 1000); // in ms
  const avgHR = hrs.reduce((a, b) => a + b, 0) / hrs.length;
  const avgRR = rrs.reduce((a, b) => a + b, 0) / rrs.length;
  const maxRR = Math.max(...rrs);
  const minRR = Math.min(...rrs);
  const rmssd = Math.sqrt(
    rrs.slice(1).reduce((acc, rr, i) => acc + Math.pow(rr - rrs[i], 2), 0) / (rrs.length - 1)
  );
  const sdnn = Math.sqrt(rrs.reduce((acc, rr) => acc + Math.pow(rr - avgRR, 2), 0) / rrs.length);

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        background: '#0a0e1add',
        border: '1px solid #5577ff44',
        borderRadius: 6,
        padding: '8px 12px',
        color: '#88aaff',
        fontFamily: 'monospace',
        fontSize: 11,
        zIndex: 10,
        minWidth: 180,
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#aaccff', fontWeight: 'bold', marginBottom: 4 }}>
        HR Interval Variance
      </div>
      <div>
        Avg HR: <span style={{ color: '#fff' }}>{avgHR.toFixed(1)} bpm</span>
      </div>
      <div>
        ΔRR max: <span style={{ color: '#fff' }}>{(maxRR - minRR).toFixed(0)} ms</span>
      </div>
      <div>
        SDNN: <span style={{ color: '#fff' }}>{sdnn.toFixed(1)} ms</span>
      </div>
      <div>
        RMSSD: <span style={{ color: '#fff' }}>{rmssd.toFixed(1)} ms</span>
      </div>
      {rmssd > 40 && <div style={{ color: '#66ff99', marginTop: 2 }}>✓ Normal HRV</div>}
      {rmssd < 20 && <div style={{ color: '#ff8866', marginTop: 2 }}>⚠ Low HRV</div>}
    </div>
  );
}

// ─── Main ECG Waveform Viewport ────────────────────────────────────────────────

let measureId = 0;

export default function ECGWaveformViewport({ displaySets, servicesManager }: any) {
  const displaySet = displaySets?.[0];
  const [leads, setLeads] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [measurements, setMeasurements] = useState<QTMeasurement[]>([]);
  const [activeQT, setActiveQT] = useState<ActiveQTState | null>(null);
  const [hrMeasurements, setHrMeasurements] = useState<HRMeasurement[]>([]);
  const [activeHR, setActiveHR] = useState<ActiveHRState | null>(null);
  const [rectMeasurements, setRectMeasurements] = useState<RectMeasurement[]>([]);
  const [activeRect, setActiveRect] = useState<ActiveRectState | null>(null);
  const [qrsMeasurements, setQrsMeasurements] = useState<QRSAxisMeasurement[]>([]);
  const [activeQRS, setActiveQRS] = useState<ActiveQRSAxisState | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

  // Subscribe to active tool changes from the toolbar
  useEffect(() => {
    const unsub = ecgToolState.subscribe(tool => {
      setActiveTool(tool);
      // Clear in-progress states when switching tools
      setActiveQT(null);
      setActiveHR(null);
      setActiveHR(null);
      setActiveRect(null);
      setActiveQRS(null);
    });
    // Initialize with current tool
    setActiveTool(ecgToolState.getActiveTool());
    return unsub;
  }, []);

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries)
        setDimensions({
          width: Math.max(e.contentRect.width, 200),
          height: Math.max(e.contentRect.height, 200),
        });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Load ECG data
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const instance = displaySet?.instance;
        if (!instance) {
          setLeads(generateDemoECG());
          setError('Demo mode: Showing synthetic 12-Lead ECG.');
          setLoading(false);
          return;
        }
        const meta = DicomMetadataStore.getInstance(
          instance.StudyInstanceUID,
          instance.SeriesInstanceUID,
          instance.SOPInstanceUID
        );
        const parsed = parseWaveformData(meta || instance);
        if (parsed?.length) {
          setLeads(parsed);
          setError(null);
        } else {
          setLeads(generateDemoECG());
          setError('Demo mode: Binary waveform not available. Showing synthetic ECG.');
        }
      } catch (e: any) {
        setLeads(generateDemoECG());
        setError('Demo: ' + e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [displaySet]);

  // Convert pixel x to time in seconds
  const pixelToSec = useCallback(
    (px: number) => {
      const totalSec = (leads?.[0]?.samplesPerChannel || 5000) / (leads?.[0]?.samplingFreq || 500);
      return (px / dimensions.width) * totalSec;
    },
    [leads, dimensions.width]
  );

  // Convert pixel height to millivolts
  // ECG standard: 10mm/mV, 25mm/s. The svgH spans all leads in rows.
  // We compute the mV value from the proportion of a single lead row that the rect covers.
  const pixelToMv = useCallback(
    (py: number, svgHeightPx: number) => {
      const numLeads = leads?.length || 12;
      const cols = numLeads >= 12 ? 4 : numLeads >= 6 ? 2 : 1;
      const rows = Math.ceil(numLeads / cols);
      const leadH = svgHeightPx / rows;
      // 10mm/mV standard; we treat one lead row ≈ 4mV full scale
      const mvPerLeadH = 4;
      return (py / leadH) * mvPerLeadH;
    },
    [leads]
  );

  // Get SVG coords from mouse event
  const getCoords = useCallback((e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Get only x from mouse event (for HR which is column-spanning)
  const getXCoord = useCallback((e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return e.clientX - rect.left;
  }, []);

  // ── QT Click Handler ──────────────────────────────────────────────────────
  const handleQTClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const pt = getCoords(e);

      if (!activeQT) {
        setActiveQT({ step: 2, q1: pt, cursor: pt });
      } else if (activeQT.step === 2) {
        setActiveQT({ step: 3, q1: activeQT.q1, t: pt, cursor: pt });
      } else if (activeQT.step === 3) {
        const q1 = activeQT.q1!;
        const t = activeQT.t!;
        const q2 = pt;
        const rrSec = pixelToSec(Math.abs(q2.x - q1.x));
        const qtSec = pixelToSec(Math.abs(t.x - q1.x));
        const qtcSec = Math.sqrt(rrSec) > 0 ? qtSec / Math.sqrt(rrSec) : 0;

        setMeasurements(prev => [
          ...prev,
          {
            id: ++measureId,
            q1,
            t,
            q2,
            rrSec,
            qtSec,
            qtcSec,
          },
        ]);
        setActiveQT(null);
      }
    },
    [activeQT, getCoords, pixelToSec]
  );

  // ── HR Click Handler ──────────────────────────────────────────────────────
  const handleHRClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const x = getXCoord(e);

      if (!activeHR) {
        // First click: plant anchor line
        setActiveHR({ x1: x, cursorX: x });
      } else {
        // Second click: finalize measurement
        const x1 = activeHR.x1;
        const x2 = x;
        const rrSec = pixelToSec(Math.abs(x2 - x1));
        const hrBpm = rrSec > 0 ? 60 / rrSec : 0;
        const newId = ++measureId;

        setHrMeasurements(prev => [
          ...prev,
          {
            id: newId,
            x1: Math.min(x1, x2),
            x2: Math.max(x1, x2),
            rrSec,
            hrBpm,
            svgH: 0, // will use from render context
          },
        ]);
        // Notify side panel
        hrBus.add({ id: newId, rrSec, hrBpm });
        setActiveHR(null);
      }
    },
    [activeHR, getXCoord, pixelToSec]
  );

  // ── Measurement Rectangle Click Handler ──────────────────────────────────
  const handleRectClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const pt = getCoords(e);

      if (!activeRect) {
        // First click: set anchor corner
        setActiveRect({ x1: pt.x, y1: pt.y, cursorX: pt.x, cursorY: pt.y });
      } else {
        // Second click: finalise rectangle
        const x1 = activeRect.x1;
        const y1 = activeRect.y1;
        const x2 = pt.x;
        const y2 = pt.y;
        const timeSec = pixelToSec(Math.abs(x2 - x1));
        const voltMv = pixelToMv(Math.abs(y2 - y1), dimensions.height - (error ? 54 : 34));
        const bpm = timeSec > 0 ? 60 / timeSec : 0;

        setRectMeasurements(prev => [
          ...prev,
          { id: ++measureId, x1, y1, x2, y2, timeSec, voltMv, bpm },
        ]);
        rectBus.add({ id: measureId, timeSec, voltMv, bpm });
        setActiveRect(null);
      }
    },
    [activeRect, getCoords, pixelToSec, pixelToMv, dimensions.height, error]
  );

  // ── QRS Axis Click Handler ───────────────────────────────────────────────
  const handleQRSClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const x = getXCoord(e);

      if (!activeQRS) {
        setActiveQRS({ x1: x, cursorX: x });
      } else {
        const x1 = activeQRS.x1;
        const x2 = x;
        const sortedX1 = Math.min(x1, x2);
        const sortedX2 = Math.max(x1, x2);

        let axisDeg = 0;
        let boundsI = { max: 0, min: 0, baseline: 0 };
        let boundsaVF = { max: 0, min: 0, baseline: 0 };

        if (leads?.length) {
          const numLeads = leads.length;
          const cols = numLeads >= 12 ? 4 : numLeads >= 6 ? 2 : 1;
          const leadW = dimensions.width / cols;

          // Determine column and map X to local sample index
          const colX = Math.floor(sortedX1 / leadW);
          const localX1 = sortedX1 - colX * leadW;
          const localX2 = sortedX2 - colX * leadW; // We assume x2 is in the same col

          const totalSamples = leads[0]?.samplesPerChannel || 5000;
          const startIndex = Math.max(0, Math.floor((localX1 / leadW) * totalSamples));
          const endIndex = Math.min(totalSamples - 1, Math.ceil((localX2 / leadW) * totalSamples));

          const iLead = leads.find(l => l.name === 'I') || leads[0];
          const aVFLead = leads.find(l => l.name === 'aVF') || leads[5] || leads[0];

          const iData = iLead.data.slice(startIndex, endIndex + 1);
          const aVFData = aVFLead.data.slice(startIndex, endIndex + 1);

          const baselineI = iData[0] || 0;
          const baselineaVF = aVFData[0] || 0;

          const maxI = iData.length ? Math.max(...iData) : 0;
          const minI = iData.length ? Math.min(...iData) : 0;
          const maxaVF = aVFData.length ? Math.max(...aVFData) : 0;
          const minaVF = aVFData.length ? Math.min(...aVFData) : 0;

          const netI = maxI - baselineI + (minI - baselineI);
          const netaVF = maxaVF - baselineaVF + (minaVF - baselineaVF);

          // Medical positive aVF points down (+90 degrees), standard atan2 natively maps this correctly.
          axisDeg = Math.atan2(netaVF, netI) * (180 / Math.PI);

          boundsI = { max: maxI, min: minI, baseline: baselineI };
          boundsaVF = { max: maxaVF, min: minaVF, baseline: baselineaVF };
        }

        const newId = ++measureId;
        setQrsMeasurements(prev => [
          ...prev,
          { id: newId, x1: sortedX1, x2: sortedX2, axisDeg, boundsI, boundsaVF },
        ]);
        qrsBus.add({ id: newId, axisDeg });
        setActiveQRS(null);
      }
    },
    [activeQRS, getXCoord, leads, dimensions.width]
  );

  // ── Unified Click Handler ─────────────────────────────────────────────────
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const tool = ecgToolState.getActiveTool();
      if (tool === 'QTPoints') {
        handleQTClick(e);
      } else if (tool === 'Hr') {
        handleHRClick(e);
      } else if (tool === 'Measurement') {
        handleRectClick(e);
      } else if (tool === 'QRSAxis') {
        handleQRSClick(e);
      }
      // Other tools: no click behavior
    },
    [handleQTClick, handleHRClick, handleRectClick, handleQRSClick]
  );

  // ── Mouse Move Handler ────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const tool = ecgToolState.getActiveTool();
      if (tool === 'QTPoints' && activeQT) {
        setActiveQT(prev => (prev ? { ...prev, cursor: getCoords(e) } : null));
      } else if (tool === 'Hr' && activeHR) {
        const x = getXCoord(e);
        setActiveHR(prev => (prev ? { ...prev, cursorX: x } : null));
      } else if (tool === 'Measurement' && activeRect) {
        const pt = getCoords(e);
        setActiveRect(prev => (prev ? { ...prev, cursorX: pt.x, cursorY: pt.y } : null));
      } else if (tool === 'QRSAxis' && activeQRS) {
        const x = getXCoord(e);
        setActiveQRS(prev => (prev ? { ...prev, cursorX: x } : null));
      }
    },
    [activeQT, activeHR, activeRect, activeQRS, getCoords, getXCoord]
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setActiveQT(null);
      setActiveHR(null);
      setActiveRect(null);
      setActiveQRS(null);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (loading) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0e1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            border: '3px solid #1e2a4a',
            borderTop: '3px solid #4facfe',
            borderRadius: '50%',
          }}
        />
        <p style={{ color: '#4facfe', marginTop: 12, fontFamily: 'monospace' }}>
          Loading ECG Waveform…
        </p>
      </div>
    );
  }

  const numLeads = leads?.length || 12;
  const cols = numLeads >= 12 ? 4 : numLeads >= 6 ? 2 : 1;
  const rows = Math.ceil(numLeads / cols);
  const { width, height } = dimensions;
  const headerH = error ? 54 : 34;
  const svgH = Math.max(height - headerH, 100);
  const leadW = width / cols;
  const leadH = svgH / rows;

  // Step hint
  const getStepHint = () => {
    const tool = activeTool;
    if (tool === 'QTPoints') {
      if (!activeQT) return '🎯 Click Q onset (QRS start) → T end → next Q onset  ·  RR / QT / QTc';
      if (activeQT.step === 2) return '2/3 — Click T point (end of T wave)';
      return '3/3 — Click next Q onset (next beat)';
    }
    if (tool === 'Hr') {
      if (!activeHR) return '❤ Click 1st R-peak → then click 2nd R-peak  ·  Measures RR & HR';
      return '2/2 — Click 2nd R-peak to complete HR measurement';
    }
    if (tool === 'Measurement') {
      if (!activeRect)
        return '📐 Click first corner → click opposite corner to measure time, voltage & BPM';
      return '2/2 — Click opposite corner to complete rectangle measurement';
    }
    if (tool === 'QRSAxis') {
      if (!activeQRS) return '⟳ QRS Axis — Click start of QRS complex';
      return '2/2 — Click end of QRS complex to measure Axis';
    }
    return '🎯 Select a measurement tool from the toolbar above';
  };

  // Get cursor style
  const cursorStyle =
    activeTool === 'QTPoints' ||
    activeTool === 'Hr' ||
    activeTool === 'Measurement' ||
    activeTool === 'QRSAxis'
      ? 'crosshair'
      : 'default';

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#0a0e1a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'monospace',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '5px 12px',
          background: '#151a2f',
          borderBottom: '1px solid #1e2a4a',
          flexShrink: 0,
          gap: 12,
        }}
      >
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>
          ECG Waveform — {displaySet?.SeriesDescription || '12-Lead ECG'}
        </span>
        <span style={{ color: '#5bc8f5', fontSize: 11, flex: 1, textAlign: 'center' }}>
          {getStepHint()}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#4facfe', fontSize: 11 }}>
            {leads?.[0]?.samplingFreq || 500} Hz | 25 mm/s | 10 mm/mV
          </span>
          {(activeQT || activeHR || activeRect || activeQRS) && (
            <button
              onClick={() => {
                setActiveQT(null);
                setActiveHR(null);
                setActiveRect(null);
                setActiveQRS(null);
              }}
              style={{
                background: '#555',
                color: '#fff',
                border: 'none',
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Cancel (Esc)
            </button>
          )}
          {(measurements.length > 0 ||
            hrMeasurements.length > 0 ||
            rectMeasurements.length > 0 ||
            qrsMeasurements.length > 0) && (
            <button
              onClick={() => {
                setMeasurements([]);
                setHrMeasurements([]);
                setRectMeasurements([]);
                setQrsMeasurements([]);
                hrBus.clear();
                rectBus.clear();
                qrsBus.clear();
              }}
              style={{
                background: '#e53935',
                color: '#fff',
                border: 'none',
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Clear All
            </button>
          )}
        </div>
      </div>
      {error && (
        <div
          style={{
            background: '#2a1a00',
            borderLeft: '3px solid #ff9800',
            color: '#ff9800',
            padding: '4px 12px',
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* Viewport */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {/* Background waveform (no pointer events) */}
        <svg
          width={width}
          height={svgH}
          style={{ background: '#0a0e1a', display: 'block', position: 'absolute', top: 0, left: 0 }}
        >
          <ECGGrid
            width={width}
            height={svgH}
          />
          {leads?.map((lead, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            return (
              <g
                key={lead.name}
                transform={`translate(${col * leadW},${row * leadH})`}
              >
                <text
                  x={6}
                  y={16}
                  fill="#4facfe"
                  fontSize={11}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {lead.name}
                </text>
                <line
                  x1={0}
                  y1={leadH}
                  x2={leadW}
                  y2={leadH}
                  stroke="#1e2a4a"
                  strokeWidth={1}
                />
                <path
                  d={getWaveformPath(lead.data, leadW, leadH)}
                  fill="none"
                  stroke="#00e676"
                  strokeWidth={1.3}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
        </svg>

        {/* Interactive overlay — captures clicks, shows measurements */}
        <svg
          ref={overlayRef}
          width={width}
          height={svgH}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            cursor: cursorStyle,
            pointerEvents: 'all',
          }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
        >
          {/* ── QT Completed measurements ── */}
          {measurements.map(m => (
            <QTMeasurementShape
              key={m.id}
              m={m}
            />
          ))}
          {/* ── QT Active in-progress measurement ── */}
          {activeQT && <ActiveQTPreview state={activeQT} />}

          {/* ── HR Completed measurements ── */}
          {hrMeasurements.map(m => (
            <HRRulerLines
              key={m.id}
              x1={m.x1}
              x2={m.x2}
              svgH={svgH}
              rrSec={m.rrSec}
              hrBpm={m.hrBpm}
            />
          ))}

          {/* ── HR In-progress measurement (live preview) ── */}
          {activeHR &&
            (() => {
              const x1 = activeHR.x1;
              const x2 = activeHR.cursorX;
              const dxPx = Math.abs(x2 - x1);
              const rrSec = pixelToSec(dxPx);
              const hrBpm = rrSec > 0.1 ? 60 / rrSec : 0;
              const sortedX1 = Math.min(x1, x2);
              const sortedX2 = Math.max(x1, x2);
              return (
                <HRRulerLines
                  x1={sortedX1}
                  x2={sortedX2}
                  svgH={svgH}
                  rrSec={rrSec}
                  hrBpm={hrBpm}
                  isDashed={true}
                  opacity={0.75}
                />
              );
            })()}

          {/* ── QRS Axis — completed ── */}
          {qrsMeasurements.map(m => (
            <QRSAxisMeasurementShape
              key={m.id}
              m={m}
              svgH={svgH}
              leads={leads || []}
              cols={cols}
              leadW={leadW}
              leadH={leadH}
            />
          ))}

          {/* ── QRS Axis — live preview ── */}
          {activeQRS && (
            <ActiveQRSPreview
              state={activeQRS}
              svgH={svgH}
            />
          )}

          {/* ── Measurement Rectangle — completed ── */}
          {rectMeasurements.map(m => (
            <RectMeasurementShape
              key={m.id}
              m={m}
            />
          ))}

          {/* ── Measurement Rectangle — live preview ── */}
          {activeRect &&
            (() => {
              const dxPx = Math.abs(activeRect.cursorX - activeRect.x1);
              const dyPx = Math.abs(activeRect.cursorY - activeRect.y1);
              const timeSec = pixelToSec(dxPx);
              const voltMv = pixelToMv(dyPx, svgH);
              const bpm = timeSec > 0.05 ? 60 / timeSec : 0;
              return (
                <ActiveRectPreview
                  state={activeRect}
                  timeSec={timeSec}
                  voltMv={voltMv}
                  bpm={bpm}
                />
              );
            })()}
        </svg>

        {/* HR Interval Variance Panel (top-right overlay) */}
        {hrMeasurements.length >= 2 && <HRVariancePanel measurements={hrMeasurements} />}
      </div>
    </div>
  );
}

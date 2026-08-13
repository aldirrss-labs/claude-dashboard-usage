"use client";

import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

interface TimeSeriesPoint {
  bucketStart: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

// Validated categorical palette (dataviz skill, references/palette.md), slots 1-4.
const COLOR_INPUT = "#2a78d6"; // blue
const COLOR_OUTPUT = "#eb6834"; // orange
const COLOR_CACHE_READ = "#1baf7a"; // aqua
const COLOR_CACHE_WRITE = "#eda100"; // yellow

type StackMode = "absolute" | "percentage";

function toPercentageStack(data: TimeSeriesPoint[]): TimeSeriesPoint[] {
  return data.map((point) => {
    const total = point.input_tokens + point.output_tokens + point.cache_creation_input_tokens + point.cache_read_input_tokens;
    if (total === 0) return point;
    return {
      bucketStart: point.bucketStart,
      input_tokens: (point.input_tokens / total) * 100,
      output_tokens: (point.output_tokens / total) * 100,
      cache_creation_input_tokens: (point.cache_creation_input_tokens / total) * 100,
      cache_read_input_tokens: (point.cache_read_input_tokens / total) * 100,
    };
  });
}

export function UsageTimeSeriesChart({ data }: { data: TimeSeriesPoint[] }) {
  const [mode, setMode] = useState<StackMode>("absolute");
  const chartData = mode === "percentage" ? toPercentageStack(data) : data;

  return (
    <div>
      <div className="mb-2 flex justify-end gap-1 text-xs">
        <button
          onClick={() => setMode("absolute")}
          className={`rounded px-2 py-1 ${mode === "absolute" ? "bg-neutral-200 font-medium dark:bg-neutral-700" : "text-neutral-500"}`}
        >
          Stacked
        </button>
        <button
          onClick={() => setMode("percentage")}
          className={`rounded px-2 py-1 ${mode === "percentage" ? "bg-neutral-200 font-medium dark:bg-neutral-700" : "text-neutral-500"}`}
        >
          100% Stacked
        </button>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" opacity={0.6} />
          <XAxis dataKey="bucketStart" tick={{ fontSize: 12, fill: "#898781" }} />
          <YAxis
            tick={{ fontSize: 12, fill: "#898781" }}
            tickFormatter={(value) => (mode === "percentage" ? `${value}%` : value.toLocaleString())}
          />
          <Tooltip />
          <Legend />
          <Area
            type="monotone"
            dataKey="input_tokens"
            stackId="1"
            name="Input"
            stroke={COLOR_INPUT}
            fill={COLOR_INPUT}
            fillOpacity={0.1}
          />
          <Area
            type="monotone"
            dataKey="output_tokens"
            stackId="1"
            name="Output"
            stroke={COLOR_OUTPUT}
            fill={COLOR_OUTPUT}
            fillOpacity={0.1}
          />
          <Area
            type="monotone"
            dataKey="cache_read_input_tokens"
            stackId="1"
            name="Cache read"
            stroke={COLOR_CACHE_READ}
            fill={COLOR_CACHE_READ}
            fillOpacity={0.1}
          />
          <Area
            type="monotone"
            dataKey="cache_creation_input_tokens"
            stackId="1"
            name="Cache write"
            stroke={COLOR_CACHE_WRITE}
            fill={COLOR_CACHE_WRITE}
            fillOpacity={0.1}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

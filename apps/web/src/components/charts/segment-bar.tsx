import { ChartLegend } from './chart-tooltip';
import { TONE_COLOR, type Tone } from './chart-utils';

export interface Segment {
  id: string;
  label: string;
  value: number;
  tone: Tone;
}

/**
 * Part-to-whole as one bar split into segments, a 2px surface gap between
 * them and 4px rounded outer ends. Segments are never labelled inside (they
 * may not fit); the legend beneath is always shown and carries every value.
 */
export function SegmentBar({
  segments,
  ariaLabel,
  height = 12,
  showLegend = true,
}: {
  segments: Segment[];
  ariaLabel: string;
  height?: number;
  showLegend?: boolean;
}) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className="viz-root flex flex-col gap-2.5">
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex w-full gap-0.5"
        style={{ height, background: shown.length === 0 ? 'var(--muted)' : undefined, borderRadius: 4 }}
      >
        {shown.map((s, i) => (
          <div
            key={s.id}
            title={`${s.label}: ${s.value}`}
            className="min-w-[2px] transition-[filter] hover:brightness-110"
            style={{
              flexGrow: s.value,
              background: TONE_COLOR[s.tone],
              borderTopLeftRadius: i === 0 ? 4 : 0,
              borderBottomLeftRadius: i === 0 ? 4 : 0,
              borderTopRightRadius: i === shown.length - 1 ? 4 : 0,
              borderBottomRightRadius: i === shown.length - 1 ? 4 : 0,
            }}
          />
        ))}
      </div>
      {showLegend && (
        <ChartLegend items={segments.map((s) => ({ color: TONE_COLOR[s.tone], label: s.label, value: String(s.value) }))} />
      )}
    </div>
  );
}

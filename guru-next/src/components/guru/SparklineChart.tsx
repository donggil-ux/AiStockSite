'use client';

// 분기별 비중 트렌드 미니 차트 (Recharts LineChart)
import { LineChart, Line, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface SparklineChartProps {
  data: number[];
  /** line 컬러. 기본: 증가=green / 감소=red / 기본=blue */
  color?: string;
  height?: number;
  /** 툴팁 활성화 */
  showTooltip?: boolean;
  /** 마지막 점 강조 */
  showLastDot?: boolean;
}

interface ChartDatum {
  idx: number;
  value: number;
}

export const SparklineChart = ({
  data,
  color,
  height = 40,
  showTooltip = false,
  showLastDot = true,
}: SparklineChartProps) => {
  // 빈 데이터 가드
  if (!data || data.length === 0) {
    return <div className="w-full bg-zinc-900/40 rounded" style={{ height }} />;
  }

  // 증감 기준 컬러 자동 결정
  const autoColor =
    color ?? (data[data.length - 1] >= data[0] ? '#22C55E' : '#EF4444');

  const chartData: ChartDatum[] = data.map((value, idx) => ({ idx, value }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis domain={['dataMin', 'dataMax']} hide />
          {showTooltip && (
            <Tooltip
              contentStyle={{
                backgroundColor: '#161B22',
                border: '1px solid #27272A',
                borderRadius: '6px',
                fontSize: '11px',
              }}
              labelFormatter={(idx: number) => `${data.length - 1 - idx}Q ago`}
              formatter={(v: number) => [`${v.toFixed(2)}%`, 'weight']}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={autoColor}
            strokeWidth={1.5}
            dot={false}
            activeDot={showLastDot ? { r: 3, fill: autoColor } : false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

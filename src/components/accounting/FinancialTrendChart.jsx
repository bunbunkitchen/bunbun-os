/**
 * Chart showing six monthly journal-based financial metrics.
 * Missing periods remain gaps (never artificial zero).
 */
const currencyAxis = value => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return (value / 1_000_000).toLocaleString("id-ID", {
      maximumFractionDigits: 1,
    }) + " jt";
  }
  if (abs >= 1000) {
    return (value / 1000).toLocaleString("id-ID", {
      maximumFractionDigits: 0,
    }) + " rb";
  }
  return Math.round(value).toLocaleString("id-ID");
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export default function FinancialTrendChart({ data }) {
  const count = Array.isArray(data) ? data.length : 0;
  const values = (data || []).flatMap(row =>
    [row.revenue, row.netProfit].filter(Number.isFinite));
  if (!count || !values.length) {
    return <p className="py-10 text-center text-sm text-[#777A6D]">
      Belum tersedia data jurnal yang valid untuk grafik.
    </p>;
  }

  const width = 820;
  const height = 284;
  const left = 82;
  const right = 28;
  const top = 23;
  const bottom = 46;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const dataMin = Math.min(0, ...values);
  const dataMax = Math.max(0, ...values);
  const range = Math.max(1, dataMax - dataMin);
  const min = dataMin - range * 0.1;
  const max = dataMax + range * 0.1;
  const x = index => left + (count === 1 ? plotWidth / 2 :
    plotWidth * index / (count - 1));
  const y = number => top + (max - number) / (max - min) * plotHeight;
  const rows = [0, 1, 2, 3, 4].map(i => ({
    value: max - (max - min) * i / 4,
    y: top + plotHeight * i / 4,
  }));

  const series = [
    { key: "revenue", name: "Pendapatan hak Bunbun", stroke: "#62745B" },
    { key: "netProfit", name: "Laba bersih", stroke: "#CF8D7B" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#575C50]">
        {series.map(s => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="h-[3px] w-7 rounded-full" style={{ backgroundColor: s.stroke }} />
            <span>{s.name}</span>
          </div>
        ))}
      </div>
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={"0 0 " + width + " " + height}
          role="img"
          aria-label="Grafik pendapatan hak Bunbun dan laba bersih per bulan. Periode tanpa jurnal siap dibiarkan kosong."
          className="min-w-[560px] w-full"
        >
          {rows.map((row, i) => (
            <g key={i}>
              <line x1={left} y1={row.y} x2={width - right} y2={row.y}
                stroke="#E9E8E2" strokeWidth="1" />
              <text x={left - 12} y={row.y + 4} textAnchor="end"
                fill="#7D8176" fontSize="12">
                {currencyAxis(row.value)}
              </text>
            </g>
          ))}
          {min <= 0 && max >= 0 && (
            <line x1={left} y1={y(0)} x2={width - right} y2={y(0)}
              stroke="#D9C9BE" strokeDasharray="5 5" />
          )}
          {(data || []).map((row, i) => {
            const monthNumber = Number(row.month.slice(5, 7)) - 1;
            return (
              <text key={row.month} x={x(i)} y={height - 18}
                textAnchor="middle" fill="#61675C" fontSize="12">
                {MONTH_NAMES[monthNumber]} {row.month.slice(2, 4)}
              </text>
            );
          })}
          {series.map(s => (
            <g key={s.key}>
              {(data || []).slice(1).map((row, i) => {
                const previous = data[i];
                if (!Number.isFinite(row[s.key]) ||
                  !Number.isFinite(previous[s.key])) return null;
                return (
                  <line key={row.month} x1={x(i)} y1={y(previous[s.key])}
                    x2={x(i + 1)} y2={y(row[s.key])}
                    stroke={s.stroke} strokeWidth="3.5" strokeLinecap="round" />
                );
              })}
              {(data || []).map((row, i) => !Number.isFinite(row[s.key]) ? null : (
                <circle key={row.month} cx={x(i)} cy={y(row[s.key])}
                  r="5.5" fill={s.stroke} stroke="#fff" strokeWidth="2" />
              ))}
            </g>
          ))}
        </svg>
      </div>
      <p className="mt-2 text-xs text-[#777A6D]">
        Grafik mengikuti bulan yang tersedia. Bulan tanpa laporan tidak dianggap memiliki pendapatan atau laba nol.
      </p>
    </div>
  );
}

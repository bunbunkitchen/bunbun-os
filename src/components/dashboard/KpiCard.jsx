export default function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tone = "amber",
}) {
  const toneClasses = {
    green: {
      card: "border-green-200 bg-green-50",
      icon: "bg-green-100 text-green-700",
      value: "text-green-700",
    },
    red: {
      card: "border-red-200 bg-red-50",
      icon: "bg-red-100 text-red-700",
      value: "text-red-700",
    },
    blue: {
      card: "border-blue-200 bg-blue-50",
      icon: "bg-blue-100 text-blue-700",
      value: "text-blue-700",
    },
    amber: {
      card: "border-amber-200 bg-amber-50",
      icon: "bg-amber-100 text-amber-700",
      value: "text-amber-700",
    },
    gray: {
      card: "border-gray-200 bg-white",
      icon: "bg-gray-100 text-gray-700",
      value: "text-gray-900",
    },
  };

  const selectedTone =
    toneClasses[tone] || toneClasses.amber;

  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${selectedTone.card}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-600">
            {title}
          </p>

          <p
            className={`mt-2 text-2xl font-bold ${selectedTone.value}`}
          >
            {value}
          </p>

          {subtitle && (
            <p className="mt-2 text-xs text-gray-500">
              {subtitle}
            </p>
          )}
        </div>

        {icon && (
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl text-2xl ${selectedTone.icon}`}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
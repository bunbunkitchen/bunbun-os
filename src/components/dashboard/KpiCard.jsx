export default function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tone = "amber",
}) {
  const toneClasses = {
    green: {
      card: "border-[#C7CDBF] bg-[#F1F3ED]",
      icon: "bg-[#C7CDBF] text-[#595E48]",
      value: "text-[#595E48]",
    },

    red: {
      card: "border-[#EECFCA] bg-[#FAEFED]",
      icon: "bg-[#EECFCA] text-[#B56F69]",
      value: "text-[#B56F69]",
    },

    blue: {
      card: "border-[#C7CDBF] bg-[#F1F3ED]",
      icon: "bg-[#919682] text-white",
      value: "text-[#595E48]",
    },

    amber: {
      card: "border-[#C7A491] bg-[#F7F0EB]",
      icon: "bg-[#C7A491] text-white",
      value: "text-[#8F6A58]",
    },

    gray: {
      card: "border-[#D9D8D0] bg-white",
      icon: "bg-[#ECE1DD] text-[#595E48]",
      value: "text-[#3F4335]",
    },
  };

  const selectedTone =
    toneClasses[tone] || toneClasses.amber;

  return (
    <div
      className={`
        rounded-2xl
        border
        p-5
        shadow-sm
        transition-all
        duration-200
        hover:-translate-y-0.5
        hover:shadow-md
        ${selectedTone.card}
      `}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#777A6D]">
            {title}
          </p>

          <p
            className={`
              mt-2
              text-2xl
              font-bold
              ${selectedTone.value}
            `}
          >
            {value}
          </p>

          {subtitle && (
            <p className="mt-2 text-xs text-[#777A6D]">
              {subtitle}
            </p>
          )}
        </div>

        {icon && (
          <div
            className={`
              flex
              h-11
              w-11
              shrink-0
              items-center
              justify-center
              rounded-xl
              text-2xl
              ${selectedTone.icon}
            `}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
export default function EmptyState({
  icon = "📦",
  title = "Belum ada data",
  description = "",
  action = null,
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
      <div className="text-4xl">
        {icon}
      </div>

      <h3 className="mt-4 text-lg font-semibold text-gray-800">
        {title}
      </h3>

      {description && (
        <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
          {description}
        </p>
      )}

      {action && (
        <div className="mt-5">
          {action}
        </div>
      )}
    </div>
  );
}
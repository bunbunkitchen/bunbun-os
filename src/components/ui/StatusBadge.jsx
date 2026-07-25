export default function StatusBadge({
  status = "Aktif",
}) {
  const isActive = status === "Aktif";

  return (
    <span
      className={`
        inline-flex rounded-full px-3 py-1 text-xs font-semibold
        ${
          isActive
            ? "bg-green-100 text-green-700"
            : "bg-gray-200 text-gray-600"
        }
      `}
    >
      {status}
    </span>
  );
}
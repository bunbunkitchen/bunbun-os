import EmptyState from "./EmptyState";

export default function DataTable({
  columns = [],
  data = [],
  emptyMessage = "Belum ada data",
  onEdit,
  onDelete,
}) {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title={emptyMessage}
        description="Data akan muncul setelah Anda menambahkan atau mencatat transaksi pertama."
      />
    );
  }

  const hasActions = Boolean(onEdit || onDelete);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full">
        <thead className="bg-stone-100">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className="whitespace-nowrap px-5 py-3 text-left text-sm font-semibold text-gray-700"
              >
                {column.title}
              </th>
            ))}

            {hasActions && (
              <th className="whitespace-nowrap px-5 py-3 text-left text-sm font-semibold text-gray-700">
                Aksi
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {data.map((row, index) => (
            <tr
              key={
                row.id ??
                row.kode ??
                row.sku ??
                index
              }
              className="border-t border-gray-200 transition hover:bg-stone-50"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className="whitespace-nowrap px-5 py-4 text-sm text-gray-700"
                >
                  {column.render
                    ? column.render(row)
                    : row[column.key]}
                </td>
              ))}

              {hasActions && (
                <td className="whitespace-nowrap px-5 py-4 text-sm">
                  <div className="flex items-center gap-2">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 font-medium text-amber-800 transition hover:bg-amber-100"
                      >
                        Edit
                      </button>
                    )}

                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(row)}
                        className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 font-medium text-red-700 transition hover:bg-red-100"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
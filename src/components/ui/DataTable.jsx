import EmptyState from "./EmptyState";

export default function DataTable({
  columns = [],
  data = [],
  emptyMessage = "Belum ada data",
}) {
  if (!data || data.length === 0) {
    return (
    <EmptyState
      title={emptyMessage}
      description="Data akan muncul setelah Anda menambahkan atau mencatat transaksi pertama."
    />
  );
}

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
          </tr>
        </thead>

        <tbody>
          {data.map((row, index) => (
            <tr
              key={row.id ?? row.kode ?? row.sku ?? index}
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
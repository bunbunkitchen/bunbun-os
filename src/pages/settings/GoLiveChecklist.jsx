import { useState } from "react";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";

const initialChecklist = [
  {
    id: 1,
    title: "Supplier sudah lengkap",
    checked: false,
  },
  {
    id: 2,
    title: "Bahan baku sudah lengkap",
    checked: false,
  },
  {
    id: 3,
    title: "Recipe sudah lengkap",
    checked: false,
  },
  {
    id: 4,
    title: "Stok awal sudah diinput",
    checked: false,
  },
  {
    id: 5,
    title: "Production Order berhasil dibuat",
    checked: false,
  },
  {
    id: 6,
    title: "Production Batch berhasil dibuat",
    checked: false,
  },
  {
    id: 7,
    title: "Inventory otomatis berkurang",
    checked: false,
  },
  {
    id: 8,
    title: "Income berhasil dicatat",
    checked: false,
  },
  {
    id: 9,
    title: "Expense berhasil dicatat",
    checked: false,
  },
  {
    id: 10,
    title: "Dashboard sesuai",
    checked: false,
  },
  {
    id: 11,
    title: "Report sesuai",
    checked: false,
  },
  {
    id: 12,
    title: "Export Excel berhasil",
    checked: false,
  },
  {
    id: 13,
    title: "Export PDF berhasil",
    checked: false,
  },
  {
    id: 14,
    title: "Backup pertama berhasil",
    checked: false,
  },
];

export default function GoLiveChecklist() {
  const [items, setItems] =
    useState(initialChecklist);

  function toggleItem(id) {
    setItems((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              checked: !item.checked,
            }
          : item
      )
    );
  }

  const completed =
    items.filter(
      (item) => item.checked
    ).length;

  const percent = Math.round(
    (completed / items.length) * 100
  );

  return (
    <div>
      <PageTitle
        title="Go Live Checklist"
        subtitle="Checklist kesiapan Bunbun Kitchen"
      />

      <Card>

        <div className="mb-6">

          <div className="flex justify-between">

            <h2 className="text-xl font-semibold">
              Progress
            </h2>

            <strong>
              {percent}%
            </strong>

          </div>

          <div className="mt-3 h-3 rounded-full bg-gray-200">

            <div
              className="h-3 rounded-full bg-green-600"
              style={{
                width: `${percent}%`,
              }}
            />

          </div>

        </div>

        <div className="space-y-3">

          {items.map((item) => (

            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-gray-50"
            >

              <input
                type="checkbox"
                checked={item.checked}
                onChange={() =>
                  toggleItem(item.id)
                }
              />

              <span
                className={
                  item.checked
                    ? "text-green-700 line-through"
                    : ""
                }
              >
                {item.title}
              </span>

            </label>

          ))}

        </div>

      </Card>
    </div>
  );
}
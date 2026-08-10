import { useRef, useState } from "react";

import { createProductStockOperationKey } from "../../services/productStockService";
import Button from "../ui/Button";
import Input from "../ui/Input";

export default function ProductionResultForm({ split, onSave, onCancel }) {
  const [form, setForm] = useState({ goodQty: "", rejectQty: "" });
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const operationKeyRef = useRef(null);

  const goodQty = Number(form.goodQty || 0);
  const rejectQty = Number(form.rejectQty || 0);
  const total = goodQty + rejectQty;

  function handleChange(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors({});
  }

  function validate() {
    const nextErrors = {};
    if (!Number.isInteger(goodQty) || goodQty < 0) {
      nextErrors.goodQty = "Jumlah berhasil harus bilangan bulat non-negatif.";
    }
    if (!Number.isInteger(rejectQty) || rejectQty < 0) {
      nextErrors.rejectQty = "Jumlah reject harus bilangan bulat non-negatif.";
    }
    if (total !== split.qty) {
      nextErrors.total = `Total berhasil dan reject harus tepat ${split.qty} pcs.`;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit() {
    if (isSaving || !validate()) return;
    const key = operationKeyRef.current || createProductStockOperationKey();
    operationKeyRef.current = key;
    setIsSaving(true);
    try {
      await onSave({ goodQty, rejectQty, operationKey: key });
    } finally {
      setIsSaving(false);
    }
  }

  const error = (field) => errors[field] && (
    <p className="mt-1 text-sm text-red-500">{errors[field]}</p>
  );

  return (
    <>
      <h2 className="mb-2 text-2xl font-bold">Catat Hasil Baking</h2>
      <p className="mb-6 text-sm text-gray-500">
        Bagian direct {split.qty} pcs
        {split.sourceLotCode ? ` · dari lot ${split.sourceLotCode}` : ""}
      </p>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Berhasil</label>
          <Input type="number" min="0" step="1" value={form.goodQty}
            disabled={isSaving} onChange={(event) => handleChange("goodQty", event.target.value)} />
          {error("goodQty")}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Reject</label>
          <Input type="number" min="0" step="1" value={form.rejectQty}
            disabled={isSaving} onChange={(event) => handleChange("rejectQty", event.target.value)} />
          {error("rejectQty")}
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-stone-100 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">Total dicatat</span>
          <span className={total === split.qty ? "font-semibold text-green-700" : "font-semibold text-amber-700"}>
            {total} / {split.qty} pcs
          </span>
        </div>
        {error("total")}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onCancel} disabled={isSaving}>Batal</Button>
        <Button onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? "Menyimpan..." : "Simpan Hasil Baking"}
        </Button>
      </div>
    </>
  );
}

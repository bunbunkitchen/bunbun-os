import { useMemo, useRef, useState } from "react";

import { createProductStockOperationKey } from "../../services/productStockService";
import Button from "../ui/Button";
import Input from "../ui/Input";

export default function BatchSplitForm({ batch, onSave, onCancel }) {
  const [form, setForm] = useState({ frozenQty: "", directQty: "", rejectQty: "" });
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const operationKeyRef = useRef(null);
  const allocation = useMemo(() => {
    const frozen = Number(form.frozenQty || 0);
    const direct = Number(form.directQty || 0);
    const reject = Number(form.rejectQty || 0);
    const total = frozen + direct + reject;
    return { frozen, direct, reject, total, remaining: Number(batch.target) - total };
  }, [batch.target, form]);

  function handleChange(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: "" }));
  }

  function validate() {
    const nextErrors = {};
    const quantities = ["frozen", "direct", "reject"];
    quantities.forEach((field) => {
      if (!Number.isInteger(allocation[field]) || allocation[field] < 0) {
        nextErrors[`${field}Qty`] = "Jumlah harus bilangan bulat non-negatif.";
      }
    });
    if (allocation.total <= 0) nextErrors.total = "Isi minimal satu jumlah hasil shaping.";
    if (allocation.total > Number(batch.target)) nextErrors.total = "Total pembagian tidak boleh melebihi jumlah batch.";
    if (allocation.remaining !== 0) nextErrors.total = "Semua jumlah batch harus dialokasikan sebelum disimpan.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate() || isSaving) return;
    const key = operationKeyRef.current || createProductStockOperationKey();
    operationKeyRef.current = key;
    setIsSaving(true);
    try {
      await onSave({ ...allocation, operationKey: key });
    } finally {
      setIsSaving(false);
    }
  }

  function renderError(field) {
    return errors[field] ? <p className="mt-1 text-sm text-red-500">{errors[field]}</p> : null;
  }

  return (
    <>
      <h2 className="mb-2 text-2xl font-bold">Catat Hasil Shaping</h2>
      <p className="mb-6 text-sm text-gray-500">Batch {batch.kode} · Jumlah {batch.target} pcs</p>
      <div className="space-y-4">
        <div><label className="mb-1 block text-sm font-medium text-gray-700">Masuk Frozen</label><Input type="number" min="0" step="1" value={form.frozenQty} disabled={isSaving} onChange={(event) => handleChange("frozenQty", event.target.value)} />{renderError("frozenQty")}</div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Kode lot dibuat otomatis saat hasil disimpan.</div>
        <div><label className="mb-1 block text-sm font-medium text-gray-700">Lanjut Langsung</label><Input type="number" min="0" step="1" value={form.directQty} disabled={isSaving} onChange={(event) => handleChange("directQty", event.target.value)} />{renderError("directQty")}</div>
        <div><label className="mb-1 block text-sm font-medium text-gray-700">Reject</label><Input type="number" min="0" step="1" value={form.rejectQty} disabled={isSaving} onChange={(event) => handleChange("rejectQty", event.target.value)} />{renderError("rejectQty")}</div>
      </div>
      <div className="mt-5 rounded-lg bg-stone-100 p-4 text-sm">
        <div className="flex justify-between gap-4"><span className="text-gray-500">Total dialokasikan</span><span className="font-semibold">{allocation.total} pcs</span></div>
        <div className="mt-2 flex justify-between gap-4"><span className="text-gray-500">Sisa</span><span className={allocation.remaining === 0 ? "font-semibold text-green-700" : "font-semibold text-amber-700"}>{allocation.remaining} pcs</span></div>
        {renderError("total")}
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onCancel} disabled={isSaving}>Batal</Button>
        <Button onClick={handleSubmit} disabled={isSaving}>{isSaving ? "Menyimpan..." : "Simpan Hasil"}</Button>
      </div>
    </>
  );
}

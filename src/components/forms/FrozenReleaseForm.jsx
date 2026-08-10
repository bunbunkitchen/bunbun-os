import { useState } from "react";

import { createProductStockOperationKey } from "../../services/productStockService";
import Button from "../ui/Button";
import Input from "../ui/Input";

export default function FrozenReleaseForm({ lot, onSave, onCancel }) {
  const [qty, setQty] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [operationKey, setOperationKey] = useState(null);

  async function handleSubmit() {
    const quantity = Number(qty);
    if (!Number.isInteger(quantity) || quantity <= 0) { setError("Jumlah harus berupa bilangan bulat lebih dari 0."); return; }
    if (quantity > lot.saldo) { setError("Jumlah tidak boleh melebihi saldo lot frozen."); return; }
    const key = operationKey || createProductStockOperationKey();
    setOperationKey(key);
    setError("");
    setIsSaving(true);
    try { await onSave({ qty: quantity, operationKey: key }); } finally { setIsSaving(false); }
  }

  return (
    <>
      <h2 className="mb-2 text-2xl font-bold">Keluarkan Frozen</h2>
      <p className="mb-6 text-sm text-gray-500">{lot.productNama} · Lot {lot.lotCode} · Saldo {lot.saldo} pcs</p>
      <Input type="number" min="1" max={lot.saldo} step="1" placeholder="Jumlah ke proofing" value={qty} disabled={isSaving} onChange={(event) => { setQty(event.target.value); setError(""); }} />
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onCancel} disabled={isSaving}>Batal</Button>
        <Button onClick={handleSubmit} disabled={isSaving}>{isSaving ? "Memproses..." : "Keluarkan ke Proofing"}</Button>
      </div>
    </>
  );
}

import { useState } from "react";

import Input from "../ui/Input";
import Button from "../ui/Button";

export default function ProductionResultForm({
  batch,
  onSave,
  onCancel,
}) {
  const [form, setForm] = useState({
    selesai: batch?.selesai ?? "",
    reject: batch?.reject ?? "",
  });

  const [errors, setErrors] = useState({});

  function handleChange(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));

    setErrors((previous) => ({
      ...previous,
      [field]: "",
    }));
  }

  function validate() {
    const newErrors = {};

    const selesai = Number(form.selesai);
    const reject = Number(form.reject);

    if (form.selesai === "") {
      newErrors.selesai =
        "Jumlah selesai wajib diisi";
    } else if (selesai < 0) {
      newErrors.selesai =
        "Jumlah selesai tidak boleh negatif";
    }

    if (form.reject === "") {
      newErrors.reject =
        "Jumlah reject wajib diisi";
    } else if (reject < 0) {
      newErrors.reject =
        "Jumlah reject tidak boleh negatif";
    }

    if (
      selesai >= 0 &&
      reject >= 0 &&
      selesai + reject > batch.target
    ) {
      newErrors.reject =
        "Total selesai dan reject tidak boleh melebihi target";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit() {
    if (!validate()) {
      return;
    }

    onSave({
      batchKode: batch.kode,
      selesai: Number(form.selesai),
      reject: Number(form.reject),
    });
  }

  function renderError(field) {
    if (!errors[field]) {
      return null;
    }

    return (
      <p className="mt-1 text-sm text-red-500">
        {errors[field]}
      </p>
    );
  }

  return (
    <>
      <h2 className="mb-2 text-2xl font-bold">
        Input Hasil Produksi
      </h2>

      <p className="mb-6 text-sm text-gray-500">
        Batch {batch.kode} · Target {batch.target} pcs
      </p>

      <div className="space-y-4">
        <div>
          <Input
            type="number"
            min="0"
            placeholder="Jumlah selesai"
            value={form.selesai}
            onChange={(event) =>
              handleChange(
                "selesai",
                event.target.value
              )
            }
          />

          {renderError("selesai")}
        </div>

        <div>
          <Input
            type="number"
            min="0"
            placeholder="Jumlah reject"
            value={form.reject}
            onChange={(event) =>
              handleChange(
                "reject",
                event.target.value
              )
            }
          />

          {renderError("reject")}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onCancel}>
          Batal
        </Button>

        <Button onClick={handleSubmit}>
          Simpan Hasil
        </Button>
      </div>
    </>
  );
}
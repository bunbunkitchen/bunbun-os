import { useEffect, useState } from "react";

import PageTitle from "../../components/ui/PageTitle";
import Card from "../../components/ui/Card";
import DataTable from "../../components/ui/DataTable";
import LoadingState from "../../components/ui/LoadingState";
import Button from "../../components/ui/Button";
import Modal from "../../components/modal/Modal";
import MaintenanceItemForm from "../../components/forms/MaintenanceItemForm";
import Currency from "../../components/ui/Currency";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";

import {
  getAllMaintenanceItems,
  createMaintenanceItem,
  updateMaintenanceItem,
  softDeleteMaintenanceItem,
} from "../../services/maintenanceService";

export default function Maintenance() {
  const toast = useToast();
  const { role } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [saving, setSaving] = useState(false);

  async function loadItems() {
    try {
      setPageError("");

      const data = await getAllMaintenanceItems();

      setItems(data);
    } catch (error) {
      console.error("Gagal memuat maintenance:", error);

      setPageError(
        error.message || "Data maintenance gagal dimuat."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, []);

  function openCreate() {
    setSelectedItem(null);
    setFormOpen(true);
  }

  function openEdit(item) {
    setSelectedItem(item);
    setFormOpen(true);
  }

  async function handleSave(values) {
    if (saving) return;

    setSaving(true);

    try {
      if (selectedItem) {
        const updated = await updateMaintenanceItem(
          selectedItem.id,
          values
        );

        setItems((previous) =>
          previous.map((item) =>
            item.id === updated.id ? updated : item
          )
        );

        toast.success(
          "Barang maintenance berhasil diperbarui."
        );
      } else {
        const created = await createMaintenanceItem(values);

        setItems((previous) => [
          created,
          ...previous,
        ]);

        toast.success(
          "Barang maintenance berhasil ditambahkan."
        );
      }

      setFormOpen(false);
      setSelectedItem(null);
    } catch (error) {
      toast.error(
        error.message ||
          "Data maintenance gagal disimpan."
      );

      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    const confirmed = window.confirm(
      `Hapus barang "${item.nama}" dari master maintenance?`
    );

    if (!confirmed) return;

    try {
      await softDeleteMaintenanceItem(item.id);

      setItems((previous) =>
        previous.filter(
          (current) => current.id !== item.id
        )
      );

      toast.success(
        "Barang maintenance berhasil dihapus."
      );
    } catch (error) {
      toast.error(
        error.message ||
          "Barang maintenance gagal dihapus."
      );
    }
  }

  const columns = [
    {
      key: "kode",
      title: "Kode",
    },
    {
      key: "nama",
      title: "Nama Barang",
    },
    {
      key: "satuan",
      title: "Satuan",
    },
    {
      key: "harga",
      title: "Harga Acuan",
      render: (item) => (
        <Currency value={item.harga} />
      ),
    },
    {
      key: "minimumStok",
      title: "Minimum Stok",
      render: (item) =>
        `${Number(
          item.minimumStok || 0
        ).toLocaleString("id-ID", {
          maximumFractionDigits: 3,
        })} ${item.satuan}`,
    },
    {
      key: "status",
      title: "Status",
      render: (item) =>
        item.isActive ? "Aktif" : "Nonaktif",
    },
  ];

  if (loading) {
    return (
      <LoadingState message="Memuat master maintenance..." />
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Maintenance"
          subtitle="Kelola kebutuhan operasional dan maintenance dapur"
        />

        {role === "owner" && (
          <Button onClick={openCreate}>
            + Tambah Barang
          </Button>
        )}
      </div>

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {pageError}
        </div>
      )}

      <Card>
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-800">
            Master Barang Maintenance
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Barang operasional dapur yang tidak
            termasuk bahan baku resep.
          </p>
        </div>

        <DataTable
          columns={columns}
          data={items}
          emptyMessage="Belum ada barang maintenance."
          onEdit={
            role === "owner"
              ? openEdit
              : undefined
          }
          onDelete={
            role === "owner"
              ? handleDelete
              : undefined
          }
        />
      </Card>

      <Modal
        open={formOpen}
        onClose={() =>
          !saving && setFormOpen(false)
        }
      >
        <MaintenanceItemForm
          initialData={selectedItem}
          onSave={handleSave}
          onCancel={() => setFormOpen(false)}
          saving={saving}
        />
      </Modal>
    </div>
  );
}